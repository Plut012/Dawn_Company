// ---- geometry
export interface Hex { q: number; r: number }        // axial, pointy-top
export type HexKey = string;                          // `${q},${r}`

// ---- ids
export type PlayerId = number;                        // seat index 0..3
export type UnitId = string;                          // `${owner}-${index}`, e.g. "0-3"
export type UnitTypeId = string;                      // key into UNITS
export type TerrainId = string;                       // key into TERRAIN
export type ActionId = string;                        // key into ACTIONS
export type OrderKind = 'move' | 'dash' | 'fire' | 'ambush' | 'special';
export type UnitStatus = 'ready' | 'pinned' | 'down';
export type Posture = 'still' | 'moved' | 'dashed';   // what a unit has done in the round, so far

// ---- content
export interface TerrainDef {
  id: TerrainId; name: string;
  cover: boolean;        // a unit here ignores the first hit on it each round
  // A unit here that did not fire is seen only from this many hexes or closer:
  // `still` if it has not moved this round, `moved` if it moved without dashing
  // (`moved: null` = a unit that moved here is seen like one in the open).
  // null = the ground hides nobody. A unit that dashed or fired is never hidden.
  hide: { still: number; moved: number | null } | null;
  blocksSight: boolean;  // adds 1 to the hex's height for lines passing through
  passable: boolean;
}
// What an action does to each unit it affects. The rules engine has one
// function per kind (src/rules/effects.ts) and knows nothing else about actions.
export type Effect =
  | { kind: 'hit'; ignoresCover?: boolean }    // the hit rule
  | { kind: 'recover' }                        // a pinned unit becomes ready
  | { kind: 'reveal' };                        // the unit counts as having fired
export interface ActionDef {
  id: ActionId; name: string; blurb: string;
  icon: string;                                // UI and kit look-up key
  phase: 'treat' | 'fire' | 'mortar';          // when its effects land
  range: number; minRange: number;             // distance to the target hex
  sight: 'own' | 'squad' | 'none';             // own line to the target hex; any friendly unit sees the hex; no need
  needs: 'any' | 'friend' | 'pinned-friend';   // what must stand on the target hex for the order to be legal
  affects: 'all' | 'friends' | 'enemies';      // who in the area the effects apply to (never the user itself)
  blast: number;                               // 0 = the hex, 1 = plus its neighbours
  effects: Effect[];
  reveals: boolean;                            // using it gives the user away
  mobile: boolean;                             // may be used after a move, as its follow-up
}
export interface UnitDef {
  id: UnitTypeId; name: string; rank: string; blurb: string;
  cost: number; max: number | null;      // max per squad, null = no limit
  move: number; sight: number;
  spotting: number;                      // added to the distance it sees a hidden unit from
  orders: OrderKind[];
  fire: ActionId | null;                 // what the `fire` order (and its ambush shot) does
  special: ActionId | null;              // what the `special` order does
}
export interface Cell { terrain: TerrainId; elevation: number }
export interface Objective { id: string; hex: Hex; value: number }
export interface GameMap {
  id: string; name: string; cols: number; rows: number;
  cells: Record<HexKey, Cell>;
  objectives: Objective[];
  spawns: Hex[][];                        // 4 zones, 8 hexes each, in placement order
  seatSpawns: Record<number, number[]>;   // playerCount -> spawn zone per seat
  maxRounds: number;
}
export interface Preset { id: string; name: string; blurb: string; units: UnitTypeId[] }
export interface Squad { player: PlayerId; units: UnitTypeId[] }
export interface RulesConfig { budget: number; minUnits: number; maxUnits: number }

// ---- state
export interface Unit {
  id: UnitId; owner: PlayerId; type: UnitTypeId; name: string;
  pos: Hex; status: UnitStatus;
  pinnedRound: number | null;   // round in which it was pinned
  revealed: boolean;            // fired in the last resolved round
  posture: Posture;             // still, moved or dashed in the last resolved round
}
export interface GameState {
  map: GameMap; playerCount: number; units: Unit[];
  round: number;                // 1-based: the round now being planned
  scores: number[]; eliminated: boolean[];
  over: boolean; winners: PlayerId[];
}
export interface PlayerView {
  player: PlayerId; map: GameMap; playerCount: number;
  round: number; maxRounds: number;
  units: Unit[];                // own units (all statuses) + visible enemy units
  visible: HexKey[];            // hexes this player can see now
  scores: number[]; eliminated: boolean[];
  over: boolean; winners: PlayerId[];
}

// ---- orders
// What a unit does where its move ends, in the assault phase. Only a `move` carries one.
export type FollowUp =
  | { kind: 'fire'; target: Hex }
  | { kind: 'special'; target: Hex };
export type Order =
  | { unit: UnitId; kind: 'move'; path: Hex[]; then?: FollowUp }   // path excludes the start hex
  | { unit: UnitId; kind: 'dash'; path: Hex[] }
  | { unit: UnitId; kind: 'fire'; target: Hex }
  | { unit: UnitId; kind: 'ambush' }
  | { unit: UnitId; kind: 'special'; target: Hex };
export interface OrderError { unit: UnitId | null; reason: string }

// ---- events (one resolved round, in order)
export type Phase = 'treat' | 'fire' | 'move' | 'assault' | 'mortar' | 'score';
export type GameEvent =
  | { t: 'phase'; phase: Phase }
  | { t: 'treat'; unit: UnitId; target: UnitId; action: ActionId }   // a `recover` effect got `target` back up
  | { t: 'fire'; unit: UnitId | null; from: Hex | null; target: Hex; blast: number; ambush: boolean; action: ActionId }
  | { t: 'launch'; unit: UnitId; from: Hex; action: ActionId }
  | { t: 'impact'; target: Hex; blast: number; action: ActionId }
  | { t: 'reveal'; unit: UnitId; action: ActionId }                  // given away by an action other than its own shot
  | { t: 'hit'; unit: UnitId; at: Hex; result: 'cover' | 'pinned' | 'down' }
  | { t: 'dash'; unit: UnitId }                                      // breaks into a run: `dashed` from now
  | { t: 'move'; step: number; unit: UnitId; from: Hex; to: Hex }
  | { t: 'blocked'; unit: UnitId; at: Hex }
  // A follow-up that did not happen: the unit is down or pinned, the target is out of range from
  // where it stands, the action's sight rule fails, or what the action needs is not on the target hex.
  | { t: 'unable'; unit: UnitId; action: ActionId; reason: 'down' | 'pinned' | 'range' | 'sight' | 'needs' }
  | { t: 'spotted'; unit: Unit }                     // an enemy comes into view
  | { t: 'lost'; unit: UnitId }                      // an enemy leaves view
  | { t: 'recover'; unit: UnitId }
  | { t: 'score'; objective: string | null; player: PlayerId; value: number }   // null: the holder is out of your sight
  | { t: 'eliminated'; player: PlayerId }
  | { t: 'over'; scores: number[]; winners: PlayerId[] };
