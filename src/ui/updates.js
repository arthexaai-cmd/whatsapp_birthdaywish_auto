import { useEffect, useState } from "react";

/**
 * The live update state from the main process
 * (disabled | idle | checking | up-to-date | available | downloading | ready | error).
 * Null until the first answer arrives.
 */
export function useUpdateState() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    window.api.updates.getState().then((s) => alive && setState(s));
    const off = window.api.updates.onState(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

/** One line for the current state, shared by the banner and the Settings card. */
export function describeUpdate(state) {
  switch (state?.status) {
    case "disabled":
      return "Updates are only available in the installed app.";
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "You have the latest version.";
    case "available":
      return `Version ${state.version} is available.`;
    case "downloading":
      return `Downloading version ${state.version}… ${state.progress}%`;
    case "ready":
      return `Version ${state.version} is downloaded and ready to install.`;
    case "error":
      return "Couldn't check for updates.";
    default:
      return "";
  }
}
