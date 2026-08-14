/**
 * User-facing errors.
 *
 * A visualisation that fails silently is worse than one that fails loudly, because the user
 * cannot tell the difference between "this planet has no atmosphere" and "the atmosphere
 * code threw". Both look like a bare sphere. So anything that goes wrong gets a panel that
 * names what failed and, wherever the failure is one of the pipeline's typed errors, what
 * it means.
 *
 * The panel is deliberately not a modal. A failure to build one planet should not prevent
 * flying to another, and blocking the whole application on a single bad catalog row would
 * be a worse outcome than the row itself.
 */

export type Severity = "error" | "warning" | "info";

export interface AppError {
  severity: Severity;
  title: string;
  detail: string;
  /** What the user can actually do about it, when there is something. */
  suggestion?: string;
}

export interface ErrorPanel {
  element: HTMLElement;
  report: (error: AppError) => void;
  /** Report a thrown value, mapping the pipeline's typed errors to readable panels. */
  reportThrown: (thrown: unknown, context: string) => void;
  clear: () => void;
  readonly count: number;
}

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Map a thrown value to something a person can read.
 *
 * Matching on `name` rather than `instanceof` because the typed errors cross a package
 * boundary and, under Vite's dev-time module graph, a class can be instantiated more than
 * once — `instanceof` then fails for an error that is unmistakably the right one. Exported
 * for tests, which is the only way to be sure the mapping stays correct as errors are added.
 */
export function describeThrown(thrown: unknown, context: string): AppError {
  if (!(thrown instanceof Error)) {
    return {
      severity: "error",
      title: `${context} failed`,
      detail: String(thrown),
    };
  }

  const suggestions: Readonly<Record<string, string>> = {
    InvalidCatalogDataError:
      "This is a defect in the bundled catalog data, not something you did. " +
      "Please report it with the field name shown above.",
    UnitMismatchError:
      "A value was supplied in a unit that cannot express the requested quantity. " +
      "This is a conversion bug rather than a missing measurement.",
    UnresolvedRequiredFieldError:
      "Nothing in the catalog, the derivations or the models can supply this value. " +
      "Selecting more missions may reveal it.",
    UnknownCatalogEntryError: "Pick a system and planet from the catalog panel.",
    TerrainProposalError:
      "A terrain proposal named an operator or parameter that does not exist. " +
      "The physics defaults were used instead.",
  };

  return {
    severity: "error",
    title: `${context} failed`,
    detail: thrown.message,
    suggestion: suggestions[thrown.name],
  };
}

export function createErrorPanel(): ErrorPanel {
  const errors: AppError[] = [];

  const element = document.createElement("aside");
  element.id = "errors";
  element.setAttribute("role", "alert");
  element.setAttribute("aria-live", "assertive");
  element.style.display = "none";

  const render = (): void => {
    if (errors.length === 0) {
      element.style.display = "none";
      element.innerHTML = "";
      return;
    }

    element.style.display = "";
    element.innerHTML = `
      <button class="err-close" aria-label="Dismiss errors">×</button>
      <h1>${errors.length} problem${errors.length === 1 ? "" : "s"}</h1>
      ${errors
        .map(
          (e) => `
        <div class="err err-${e.severity}">
          <div class="err-title">${escape(e.title)}</div>
          <div class="err-detail">${escape(e.detail)}</div>
          ${e.suggestion ? `<div class="err-hint">${escape(e.suggestion)}</div>` : ""}
        </div>`,
        )
        .join("")}`;

    element.querySelector(".err-close")?.addEventListener("click", () => {
      errors.length = 0;
      render();
    });
  };

  const report = (error: AppError): void => {
    // Deduplicated. A failure inside the render loop would otherwise append sixty identical
    // panels per second and make the real problem impossible to read.
    if (errors.some((e) => e.title === error.title && e.detail === error.detail)) return;
    errors.push(error);
    render();
  };

  return {
    element,
    report,
    reportThrown: (thrown, context) => report(describeThrown(thrown, context)),
    clear: () => {
      errors.length = 0;
      render();
    },
    get count() {
      return errors.length;
    },
  };
}

/**
 * Whether this browser can run the renderer at all.
 *
 * Checked before constructing anything, because a WebGL2 failure inside Three.js surfaces as
 * an exception from a constructor and leaves a blank page with a console message the user
 * will never see.
 */
export function webglSupportMessage(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (context) return null;
    return (
      "This browser does not support WebGL 2, which Aether needs to render. " +
      "Recent versions of Chrome, Firefox, Edge and Safari all support it; if you are on a " +
      "current browser, WebGL may be disabled in its settings or blocked by your graphics driver."
    );
  } catch (error) {
    return `WebGL could not be initialised: ${String(error)}`;
  }
}
