/**
 * The panel dock.
 *
 * Every panel used to be its own `position: fixed` element with hand-picked coordinates.
 * That worked while there were two of them and collapsed once there were six: the HUD and
 * the body list both sat at `left: 332px`, the catalog and the provenance inspector both at
 * `right: 362px`, and the six full-height panels together were wider than the screen. The
 * result was an application that opened with the 3D view almost entirely covered.
 *
 * The fix is not smaller panels. It is that panels should not know where they are. They are
 * appended to a rail, the rail stacks them, and the rail is what owns the geometry — so
 * adding a seventh panel is a one-line change that cannot collide with anything.
 *
 * Two levels of collapse, because they answer different questions:
 *
 *   - **Per panel** (the ▾ arrow in each header) — "I am done with this one for now."
 *     Collapses to its header, which stays visible and clickable.
 *   - **Per rail** (the ‹ / › arrow at the rail's edge) — "get out of the way entirely."
 *     Slides the whole rail off-screen, leaving only the reopen handle.
 *
 * Panels start collapsed. The default state of a space application should be looking at
 * space.
 */

export interface DockPanelOptions {
  id: string;
  /** Shown in the header. Keep it short — the header is one line. */
  title: string;
  element: HTMLElement;
  /** Optional one-line hint shown under the title when the panel is open. */
  hint?: string;
  /** Default is collapsed. Pass `true` for the one panel worth opening on load. */
  startOpen?: boolean;
}

export interface Dock {
  element: HTMLElement;
  add: (panel: DockPanelOptions) => void;
  /** Open a panel, collapsing whichever sibling was open. */
  open: (id: string) => void;
  toggle: (id: string) => void;
  isOpen: (id: string) => boolean;
  /** Slide the whole rail away, or bring it back. */
  setRailCollapsed: (collapsed: boolean) => void;
  toggleRail: () => void;
  readonly railCollapsed: boolean;
}

const ARROW_OPEN = "▾";
const ARROW_CLOSED = "▸";

/**
 * Create a rail.
 *
 * `side` decides which screen edge it hugs and which way the rail arrow points, and nothing
 * else. The two rails are otherwise identical, so a panel can be moved from one to the other
 * by changing a single call site.
 */
export function createDock(side: "left" | "right"): Dock {
  const panels = new Map<string, { section: HTMLElement; arrow: HTMLElement }>();
  let openId: string | null = null;
  let collapsed = false;

  const element = document.createElement("div");
  element.className = `dock dock-${side}`;

  const list = document.createElement("div");
  list.className = "dock-list";

  const railToggle = document.createElement("button");
  railToggle.className = "dock-rail-toggle";
  railToggle.type = "button";

  const paintRail = (): void => {
    element.classList.toggle("dock-collapsed", collapsed);
    // The arrow points where the rail will *go*, which is the convention people already
    // read correctly from sidebars everywhere else.
    const away = side === "left" ? "‹" : "›";
    const back = side === "left" ? "›" : "‹";
    railToggle.textContent = collapsed ? back : away;
    railToggle.setAttribute("aria-expanded", String(!collapsed));
    railToggle.setAttribute(
      "aria-label",
      collapsed ? `Show ${side} panels` : `Hide ${side} panels`,
    );
  };

  railToggle.addEventListener("click", () => {
    collapsed = !collapsed;
    paintRail();
  });

  /**
   * Panels within a rail are mutually exclusive.
   *
   * Two open panels in one rail means scrolling to reach the second, which is the same
   * screen-hogging problem one level down. One open panel per rail keeps the rail's height
   * predictable and the canvas visible.
   */
  const paintPanels = (): void => {
    for (const [id, { section, arrow }] of panels) {
      const isOpen = id === openId;
      section.classList.toggle("open", isOpen);
      arrow.textContent = isOpen ? ARROW_OPEN : ARROW_CLOSED;
      section.querySelector(".dock-head")?.setAttribute("aria-expanded", String(isOpen));
    }
  };

  if (side === "left") {
    element.append(list, railToggle);
  } else {
    element.append(railToggle, list);
  }
  paintRail();

  const open = (id: string): void => {
    if (!panels.has(id)) return;
    openId = id;
    // Opening a panel while the rail is hidden should show it, not silently do nothing.
    if (collapsed) {
      collapsed = false;
      paintRail();
    }
    paintPanels();
  };

  return {
    element,

    add({ id, title, element: body, hint, startOpen }) {
      const section = document.createElement("section");
      section.className = "dock-panel";
      section.dataset.panel = id;

      const head = document.createElement("button");
      head.className = "dock-head";
      head.type = "button";

      const arrow = document.createElement("span");
      arrow.className = "dock-arrow";
      arrow.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "dock-title";
      label.textContent = title;

      head.append(arrow, label);
      if (hint) {
        const hintEl = document.createElement("span");
        hintEl.className = "dock-hint";
        hintEl.textContent = hint;
        head.append(hintEl);
      }

      const wrap = document.createElement("div");
      wrap.className = "dock-body";
      wrap.append(body);

      head.addEventListener("click", () => {
        openId = openId === id ? null : id;
        paintPanels();
      });

      section.append(head, wrap);
      list.append(section);
      panels.set(id, { section, arrow });

      if (startOpen) openId = id;
      paintPanels();
    },

    open,

    toggle(id) {
      if (!panels.has(id)) return;
      openId = openId === id ? null : id;
      // A keyboard shortcut aimed at a hidden rail should reveal it.
      if (openId !== null && collapsed) {
        collapsed = false;
        paintRail();
      }
      paintPanels();
    },

    isOpen: (id) => openId === id,

    setRailCollapsed(next) {
      collapsed = next;
      paintRail();
    },

    toggleRail() {
      collapsed = !collapsed;
      paintRail();
    },

    get railCollapsed() {
      return collapsed;
    },
  };
}

/**
 * Turn a container's `<h2>` headings into collapsible section headers.
 *
 * Used for the sub-system lists: a system heading in the catalog, or a planet heading in the
 * Solar System gazetteer. Thirty-six bodies and seven TRAPPIST-1 planets are a lot of rows
 * to scroll past to reach the one you want, and the natural grouping — Jupiter and the four
 * things orbiting it — is exactly the grouping worth being able to fold.
 *
 * Applied after each render because both panels rebuild their innerHTML wholesale. The
 * `expanded` set is owned by the caller so the open/closed state survives that rebuild;
 * otherwise every mission toggle would snap all the groups shut.
 */
export function applySubsections(
  container: HTMLElement,
  expanded: Set<string>,
  onToggle: (key: string) => void,
): void {
  for (const heading of container.querySelectorAll<HTMLElement>("h2[data-group]")) {
    const key = heading.dataset.group;
    if (!key) continue;

    const isOpen = expanded.has(key);
    heading.classList.toggle("sub-open", isOpen);
    heading.setAttribute("role", "button");
    heading.setAttribute("tabindex", "0");
    heading.setAttribute("aria-expanded", String(isOpen));

    const arrow = heading.querySelector(".sub-arrow");
    if (arrow) arrow.textContent = isOpen ? ARROW_OPEN : ARROW_CLOSED;

    const section = heading.closest("section");
    section?.classList.toggle("sub-collapsed", !isOpen);

    const activate = (): void => onToggle(key);
    heading.addEventListener("click", activate);
    heading.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  }
}
