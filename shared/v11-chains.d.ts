/** Types for shared/v11-chains.js (the one chain/currency table of escrow v11). */
export type ChainRef = string;
export interface CurrencyInfo {
  symbol: string;
  name: string;
  chain: string;
  kind: "offchain" | "token";
  /** fungible-v2 module, tokens only */
  module?: string;
  /** decimals of the token, tokens only */
  precision?: number;
}
export interface TokenInfo extends CurrencyInfo { kind: "token"; module: string; precision: number }

export const V11_CHAINS: string[];
export const DEFAULT_CHAIN: string;
export const CURRENCIES: CurrencyInfo[];
export const GIVEAWAY_CURRENCY: string;
export function currencyInfo(symbol: string | null | undefined): CurrencyInfo | undefined;
export function tokenInfo(symbol: string | null | undefined): TokenInfo | undefined;
export function chainForCurrency(symbol: string | null | undefined): string | undefined;
export function currenciesOn(chain: string): CurrencyInfo[];
export function fitsTable(chain: string, currency: string, token: string): boolean;
export function toRef(chain: string, id: string): ChainRef;
export function parseRef(ref: string | null | undefined): { chain: string; id: string };
export function canonicalRef(ref: string): ChainRef;
export function chainOfRef(ref: string): string;
export function idOfRef(ref: string): string;
export function tokenPayFor(amount: number, price: number, precision: number): string;
