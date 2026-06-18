import { type WebSocket } from "ws";

import { type Identity } from "../auth/identity.js";
import { type Channel } from "./channels.js";

export type SocketBinding = Readonly<{
  id: string;
  socket: WebSocket;
  identity: Identity;
  channels: ReadonlySet<Channel>;
}>;

export type RegistryState = ReadonlyMap<string, SocketBinding>;

export function emptyRegistry(): RegistryState {
  return new Map();
}

export function addSocket(state: RegistryState, binding: SocketBinding): RegistryState {
  const next = new Map(state);
  next.set(binding.id, binding);
  return next;
}

export function removeSocket(state: RegistryState, id: string): RegistryState {
  const next = new Map(state);
  next.delete(id);
  return next;
}

export function setSubscriptions(
  state: RegistryState,
  id: string,
  channels: ReadonlySet<Channel>,
): RegistryState {
  const current = state.get(id);
  if (!current) {
    return state;
  }
  const next = new Map(state);
  next.set(id, Object.freeze({ ...current, channels: new Set(channels) }));
  return next;
}
