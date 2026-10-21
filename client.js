window.__ModuleLoader__.load({
  id: "dsh-completion-chime",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    const NS = "completionChime";
    const STYLE_MARK = "data-dsh-completion-chime";

    const CSS = [
      ".dsh-chime-toast {",
      "  position: fixed; left: 50%; top: calc(var(--dsh-frame-overlay-top, 64px) + 12px);",
      "  transform: translate(-50%, -6px); display: inline-flex; align-items: center; gap: 8px;",
      "  padding: 7px 14px; border-radius: 999px; pointer-events: none; z-index: 2147483000;",
      "  background: var(--dsw-alias-bg-overlay, rgba(28,28,30,.94));",
      "  color: var(--dsw-alias-label-primary, #fff);",
      "  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));",
      "  box-shadow: 0 8px 24px rgba(0,0,0,.22); font-size: 12px; line-height: 18px;",
      "  opacity: 0; animation: dsh-chime-in .18s ease-out forwards;",
      "}",
      ".dsh-chime-toast__dot { width: 7px; height: 7px; border-radius: 50%;",
      "  background: var(--dsw-alias-brand-primary, #4d8dff); }",
      "@keyframes dsh-chime-in { to { opacity: 1; transform: translate(-50%, 0); } }",
      "@media (prefers-reduced-motion: reduce) { .dsh-chime-toast { animation: none; opacity: 1; transform: translate(-50%, 0); } }",
    ].join("\n");

    /** Lazily created so the context starts inside a user gesture. */
    let audio = null;

    function audioContext() {
      if (audio !== null) return audio;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (typeof Ctor !== "function") return null;
      try {
        audio = new Ctor();
      } catch {
        audio = null;
      }
      return audio;
    }

    function tone(ac, at, frequency, duration, peak) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(at);
      osc.stop(at + duration + 0.03);
    }

    function schedule(ac) {
      if (ac.state !== "running") return;
      const start = ac.currentTime + 0.02;
      tone(ac, start, 659.25, 0.18, 0.11);
      tone(ac, start + 0.13, 987.77, 0.26, 0.09);
    }

    /**
     * Two rising notes; no asset files, works offline. A suspended context is
     * resumed before scheduling, so a hidden or minimised window still plays
     * once the browser lifts the autoplay hold.
     */
    function playChime() {
      const ac = audioContext();
      if (ac === null) return;
      if (ac.state === "running") {
        schedule(ac);
        return;
      }
      ac.resume().then(() => schedule(ac), () => {});
    }

    function readable(t, key, fallback) {
      return typeof t === "function" ? t(key) : fallback;
    }

    /**
     * Chime and toast whenever a reply ends in the viewed conversation:
     * finishing normally and stopping early both flip the session to idle.
     */
    function Overlay({ status, reportable, t }) {
      const snapshot = React.useSyncExternalStore(status.subscribe, status.getSnapshot, status.getSnapshot);
      const previous = React.useRef(snapshot);
      const serial = React.useRef(0);
      const [notice, setNotice] = React.useState(null);

      React.useEffect(() => {
        const before = previous.current;
        previous.current = snapshot;
        let ended = false;
        for (const [sessionId, next] of snapshot) {
          const was = before.get(sessionId);
          if (was === undefined || was.running !== true || next.running !== false) continue;
          if (!reportable(sessionId)) continue;
          ended = true;
          break;
        }
        if (!ended) return;
        playChime();
        serial.current += 1;
        setNotice(serial.current);
      }, [snapshot, reportable]);

      React.useEffect(() => {
        if (notice === null) return undefined;
        const timer = setTimeout(() => setNotice(null), 4000);
        return () => clearTimeout(timer);
      }, [notice]);

      if (notice === null) return null;
      return h(
        "div",
        { className: "dsh-chime-toast", role: "status", "aria-live": "polite" },
        h("span", { className: "dsh-chime-toast__dot", "aria-hidden": "true" }),
        h("span", { className: "dsh-chime-toast__text" }, readable(t, "finished", "Reply finished")),
      );
    }

    const inject = ["slots", "locale", "uiSession", "sessions"];

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            en: { finished: "Reply finished" },
            zh: { finished: "回复完成" },
          }),
        "completion-chime: locale",
      );

      ctx.effect(() => {
        if (document.querySelector("style[" + STYLE_MARK + "]") !== null) return () => {};
        const style = document.createElement("style");
        style.setAttribute(STYLE_MARK, "true");
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, "completion-chime: styles");

      // Keep the context live: a hidden or unfocused window must still play.
      audioContext();
      const unlock = () => {
        const ac = audioContext();
        if (ac !== null && ac.state !== "running") ac.resume().catch(() => {});
      };
      ctx.effect(() => {
        document.addEventListener("visibilitychange", unlock);
        window.addEventListener("focus", unlock);
        window.addEventListener("pointerdown", unlock, { passive: true });
        window.addEventListener("keydown", unlock);
        return () => {
          document.removeEventListener("visibilitychange", unlock);
          window.removeEventListener("focus", unlock);
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
        };
      }, "completion-chime: audio keep-alive");

      const viewed = () => {
        try {
          const value = ctx.uiSession.adapter.current.getSnapshot();
          return value === undefined ? undefined : value.key;
        } catch {
          return undefined;
        }
      };

      /** Only the conversation in the window reports; subagent sessions stay silent. */
      const reportable = (sessionId) => {
        const current = viewed();
        if (current !== undefined) return current === sessionId;
        try {
          const row = ctx.sessions.list.getSnapshot().byId[sessionId];
          if (row !== undefined) return row.parentSessionId == null;
        } catch {
          return true;
        }
        return true;
      };

      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "completion-chime",
            order: 100,
            locale: NS,
            inject: () => ({ status: ctx.uiSession.sessionStatus, reportable }),
          },
          Overlay,
        ),
      );
    }

    return { apply, inject };
  },
});