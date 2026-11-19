import type { GameEvent, Order, OrderError, PlayerId, PlayerView, UnitTypeId } from './types';

export interface SeatStatus { seat: PlayerId; name: string; connected: boolean; ready: boolean; out: boolean }

export type ClientMsg =
  | { t: 'join'; name: string; token?: string }   // token reclaims a seat
  | { t: 'squad'; units: UnitTypeId[] }           // lobby: set squad, clears ready
  | { t: 'ready'; ready: boolean }                // lobby: needs a valid squad
  | { t: 'start' }                                // lobby: host only, 2+ seats, all ready
  | { t: 'orders'; orders: Order[] }              // playing: commit (lever down)
  | { t: 'draft'; orders: Order[] }               // playing: the orders as they stand; does not commit
  | { t: 'recall' }                               // playing: lever up, before resolve
  | { t: 'rematch' };                             // over: host only, back to lobby

export type ServerMsg =
  | { t: 'welcome'; seat: PlayerId; token: string; host: boolean; mapId: string; squad: UnitTypeId[] }
  | { t: 'lobby'; seats: SeatStatus[] }
  | { t: 'plan'; view: PlayerView; seats: SeatStatus[]; timer: number | null; orders: Order[] | null }   // orders: what the server holds for this seat this round
  | { t: 'seats'; seats: SeatStatus[] }
  | { t: 'resolve'; events: GameEvent[]; view: PlayerView; seats: SeatStatus[]; timer: number | null }
  | { t: 'rejected'; errors: OrderError[] }
  | { t: 'error'; message: string };
