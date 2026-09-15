import {
  Account,
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

export type ContractName = keyof typeof CONTRACT_IDS;

/**
 * A contract id, or a message naming the variable that is missing.
 *
 * These default to the empty string, and `new Contract('')` throws
 * `invalid contract id` from deep inside the SDK. An unconfigured deployment
 * should say which environment variable to set, not produce a stack trace
 * about an encoding.
 */
export function contractId(name: ContractName): string {
  const id = CONTRACT_IDS[name];
  if (!id) {
    throw new Error(
      `${name.toUpperCase()}_CONTRACT_ID is not set. Deploy the contracts and ` +
        `set it in the environment — see DEPLOYMENT.md.`,
    );
  }
  return id;
}

/**
 * The source account every read is simulated against.
 *
 * Simulation does not submit, sign, or charge anything, so this only has to be
 * a syntactically valid account. It is the all-zero account, built locally.
 *
 * What was here before was a 55-character string where a Stellar public key is
 * 56 — a typo, but a load-bearing one. It was passed to `getAccount`, which
 * rejected it; the rejection was swallowed by a `.catch` that substituted a
 * stub carrying the same bad id; and the transaction then failed to encode.
 * The result was that every read endpoint — /guard/velocity and
 * /registry/drips, the two calls the dashboard actually makes — answered 500
 * with `invalid encoded string`, on every request, in every environment. The
 * `.catch` is why it read as an encoding problem rather than a bad address.
 *
 * Building the account locally also removes a network round trip per read.
 */
export const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const STROOPS_PER_XLM = 10_000_000n;

/**
 * XLM as written, to stroops, exactly.
 *
 * Not Math.round(xlm * 10_000_000): that goes through a double, which cannot
 * hold every stroop value, so large amounts stop round-tripping. Parsed as
 * digits instead.
 */
export function xlmToStroops(xlm: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(String(xlm).trim());
  if (!m) throw new Error(`Expected an amount like 2.5, got "${xlm}"`);
  return BigInt(m[1]) * STROOPS_PER_XLM + BigInt((m[2] ?? '').padEnd(7, '0'));
}

/** Stroops to a display string, without inventing precision. */
export function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = (stroops % STROOPS_PER_XLM).toString().padStart(7, '0');
  return `${whole}.${frac}`.replace(/0+$/, '').replace(/\.$/, '');
}

/** Submit a fully-signed XDR envelope to the network. */
export async function relayXDR(xdrString: string) {
  const tx = TransactionBuilder.fromXDR(xdrString, NETWORK);
  return sorobanServer.sendTransaction(tx);
}

/** Read-only Soroban contract call (simulation only, no signing). */
export async function simulateContractCall(
  id: string,
  method: string,
  args: xdr.ScVal[]
) {
  const contract = new Contract(id);
  const account = new Account(SIMULATION_SOURCE, '0');

  const tx = new TransactionBuilder(account, {
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

export interface VelocityState {
  /** null means the user has set no limit, which is different from a limit of zero. */
  limitStroops: string | null;
  spentStroops: string;
  limitXlm: string | null;
  spentXlm: string;
  remainingXlm: string | null;
  guarded: boolean;
}

/**
 * Current daily spend state for a user.
 *
 * This called `get_limit` and `get_spent`, which the contract has never had --
 * its getters are `limit_of` and `spent_today`. Both calls were wrapped in
 * .catch(() => null), so the missing methods raised nothing and the endpoint
 * returned a confident 0 / 0. Every dashboard read a limit of zero and nobody
 * saw an error.
 */
export async function getVelocityState(userAddress: string): Promise<VelocityState> {
  const userScVal = nativeToScVal(Address.fromString(userAddress), { type: 'address' });

  // No .catch here. If a call fails the caller gets a 500 saying so, which is
  // information; a silent zero is not.
  const [limit, spent] = await Promise.all([
    simulateContractCall(contractId('guard'), 'limit_of', [userScVal]),
    simulateContractCall(contractId('guard'), 'spent_today', [userScVal]),
  ]);

  const limitStroops = limit === null || limit === undefined ? null : BigInt(limit as bigint);
  const spentStroops = BigInt((spent as bigint) ?? 0n);
  const remaining =
    limitStroops !== null && limitStroops > spentStroops ? limitStroops - spentStroops : 0n;

  return {
    limitStroops: limitStroops === null ? null : limitStroops.toString(),
    spentStroops: spentStroops.toString(),
    limitXlm: limitStroops === null ? null : stroopsToXlm(limitStroops),
    spentXlm: stroopsToXlm(spentStroops),
    remainingXlm: limitStroops === null ? null : stroopsToXlm(remaining),
    guarded: limitStroops !== null && limitStroops > 0n,
  };
}

/** Check if an address is a trusted drip in RegistryContract. */
export async function isTrustedDrip(dripAddress: string): Promise<boolean> {
  const scVal = nativeToScVal(Address.fromString(dripAddress), { type: 'address' });
  const result = await simulateContractCall(contractId('registry'), 'is_trusted_drip', [scVal]);
  return Boolean(result);
}
