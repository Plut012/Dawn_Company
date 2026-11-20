import type { GameEvent, ModeId, Order, OrderError, PlayerId, PlayerView, Purchase, UnitTypeId } from './types';

export interface SeatStatus { seat: PlayerId; name: string; connected: boolean; ready: boolean; out: boolean }

export type ClientMsg =
  | { t: 'join'; name: string; token?: string }   // token reclaims a seat
  | { t: 'squad'; units: UnitTypeId[] }           // lobby: set squad, clears ready
  | { t: 'ready'; ready: boolean }                // lobby: needs a valid squad
  | { t: 'mode'; mode: ModeId }                   // lobby: host only; sets the mode, clears every seat's ready
  | { t: 'start' }                                // lobby: host only, 2+ seats, all ready
  | { t: 'orders'; orders: Order[]; purchases?: Purchase[] }   // playing: commit (lever down)
  | { t: 'draft'; orders: Order[]; purchases?: Purchase[] }    // playing: the orders as they stand; does not commit
  | { t: 'recall' }                               // playing: lever up, before resolve
  | { t: 'rematch' };                             // over: host only, back to lobby

export type ServerMsg =
  | { t: 'welcome'; seat: PlayerId; token: string; host: boolean; mapId: string; squad: UnitTypeId[] }
  | { t: 'lobby'; seats: SeatStatus[]; mode: ModeId }
  | { t: 'plan'; view: PlayerView; seats: SeatStatus[]; timer: number | null; orders: Order[] | null; purchases: Purchase[] | null }   // what the server holds for this seat this round
  | { t: 'seats'; seats: SeatStatus[] }
  | { t: 'resolve'; events: GameEvent[]; view: PlayerView; seats: SeatStatus[]; timer: number | null }
  | { t: 'rejected'; errors: OrderError[] }
  | { t: 'error'; message: string };
