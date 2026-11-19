import type { PlayerId } from '../../shared/types';
import type { Net } from '../net';

export type ScreenName = 'lobby' | 'play' | 'results';

export interface App {
  net: Net;
  seat: PlayerId;        // -1 until the server has said which seat this is
  host: boolean;
  go(screen: ScreenName, data?: unknown): void;
  /** Whatever `go` was given for the screen now mounting (often the server message that caused it). */
  data?: unknown;
}

export interface Screen { mount(root: HTMLElement, app: App): () => void }   // returns unmount
