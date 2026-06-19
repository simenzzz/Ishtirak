import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

import { AuthProvider } from "../auth/AuthContext";

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string, readonly protocols: string[]) {
    MockWebSocket.instances.push(this);
    window.setTimeout(() => this.onopen?.(), 0);
  }

  send(value: string) {
    this.sent = [...this.sent, value];
  }

  close() {
    this.onclose?.({ code: 1000 });
  }

  emit(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

export function installMockWebSocket() {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
}

export function renderWithApp(ui: ReactElement, options: RenderOptions & { route?: string } = {}) {
  const route = options.route ?? "/";
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
    options,
  );
}
