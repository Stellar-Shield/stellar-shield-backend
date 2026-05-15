import {
  Horizon,
  rpc,
  TransactionBuilder,
  Networks,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

export const sorobanServer = new rpc.Server(RPC_URL, { allowHttp: false });
export const horizonServer = new Horizon.Server(HORIZON_URL);

export const CONTRACT_IDS = {
  guard: process.env.GUARD_CONTRACT_ID || '',
  registry: process.env.REGISTRY_CONTRACT_ID || '',
  auth: process.env.AUTH_CONTRACT_ID || '',
};

const STROOPS_PER_XLM = 10_000_000n;

export function xlmToStroops(xlm: number): bigint {
  return BigInt(Math.round(xlm * 10_000_000));
}

export function stroopsToXlm(stroops: bigint): number {
  return Number(stroops) / Number(STROOPS_PER_XLM);
}

/** Submit a fully-signed XDR envelope to the network. */
export async function relayXDR(xdrString: string) {
  const tx = TransactionBuilder.fromXDR(xdrString, NETWORK);
  return sorobanServer.sendTransaction(tx);
}

/** Read-only Soroban contract call (simulation only, no signing). */
export async function simulateContractCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[]
) {
  const contract = new Contract(contractId);
  const account = await sorobanServer.getAccount(
    'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN' // fee-only source, never signs
  ).catch(() => ({ accountId: () => 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN', sequenceNumber: () => '0', incrementSequenceNumber: () => {} }));

  const tx = new TransactionBuilder(account as any, {
    fee: '100',
    networkPassphrase: NETWORK,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  return result ? scValToNative(result.retval) : null;
}

/** Fetch recent contract events from Soroban RPC. */
export async function fetchContractEvents(contractId: string, startLedger: number) {
  const response = await sorobanServer.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [contractId] }],
    limit: 100,
  });
  return response.events;
}

/** Query current velocity state for a user from GuardContract. */
export async function getVelocityState(userAddress: string) {
  const userScVal = nativeToScVal(Address.fromString(userAddress), { type: 'address' });
  const [limit, spent] = await Promise.all([
    simulateContractCall(CONTRACT_IDS.guard, 'get_limit', [userScVal]).catch(() => null),
    simulateContractCall(CONTRACT_IDS.guard, 'get_spent', [userScVal]).catch(() => null),
  ]);

  const limitStroops = BigInt(limit ?? 0);
  const spentStroops = BigInt(spent ?? 0);

  return {
    limitXlm: stroopsToXlm(limitStroops),
    spentXlm: stroopsToXlm(spentStroops),
    remainingXlm: stroopsToXlm(limitStroops - spentStroops < 0n ? 0n : limitStroops - spentStroops),
    limitStroops: limitStroops.toString(),
    spentStroops: spentStroops.toString(),
  };
}

/** Check if an address is a trusted drip in RegistryContract. */
export async function isTrustedDrip(dripAddress: string): Promise<boolean> {
  const scVal = nativeToScVal(Address.fromString(dripAddress), { type: 'address' });
  const result = await simulateContractCall(CONTRACT_IDS.registry, 'is_trusted_drip', [scVal]);
  return Boolean(result);
}
