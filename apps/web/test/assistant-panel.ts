import { expect, vi } from "vitest";

/** Waits a tick for the panel to settle, then checks it rendered nothing. */
export const expectNothingShown = async (container: HTMLElement) => {
  await new Promise((done) => setTimeout(done, 0));
  expect(container.innerHTML).toBe("");
};

/** Renders a panel with no viewer loader of its own, and checks it asked this app's server. */
export const expectToAskServer = async (renderPanel: () => { container: HTMLElement }) => {
  const fetch = vi.fn(async () =>
    Response.json({ result: { data: { canSignIn: true, signedIn: true, canAsk: false } } }),
  );
  vi.stubGlobal("fetch", fetch);
  const { container } = renderPanel();

  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(container.innerHTML).toBe("");
  vi.unstubAllGlobals();
};
