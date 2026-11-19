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

/** The ways a panel learns it isn't offered: a viewer who can't ask, or a server that can't say. */
export const NOT_OFFERED: [
  string,
  { loadViewer: () => Promise<{ canSignIn: boolean; signedIn: boolean; canAsk: boolean }> },
][] = [
  [
    "to someone who can't ask",
    { loadViewer: () => Promise.resolve({ canSignIn: true, signedIn: false, canAsk: false }) },
  ],
  ["when the server can't say", { loadViewer: () => Promise.reject(new Error("offline")) }],
];
