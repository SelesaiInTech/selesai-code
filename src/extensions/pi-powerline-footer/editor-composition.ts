import type { AutocompleteProvider } from "@earendil-works/pi-tui";

export function getEditorAutocompleteProvider(sourceEditor: unknown): AutocompleteProvider | undefined {
  const candidate = sourceEditor && typeof sourceEditor === "object" ? Reflect.get(sourceEditor, "autocompleteProvider") : null;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  if (typeof Reflect.get(candidate, "getSuggestions") !== "function") {
    return undefined;
  }
  if (typeof Reflect.get(candidate, "applyCompletion") !== "function") {
    return undefined;
  }
  return candidate;
}

export function passAutocompleteProviderThroughPreviousEditor(
  provider: AutocompleteProvider,
  previousEditor: unknown,
): AutocompleteProvider {
  if (!previousEditor || typeof previousEditor !== "object") {
    return provider;
  }

  const setAutocompleteProvider = Reflect.get(previousEditor, "setAutocompleteProvider");
  if (typeof setAutocompleteProvider !== "function") {
    return getEditorAutocompleteProvider(previousEditor) ?? provider;
  }

  setAutocompleteProvider.call(previousEditor, provider);
  return getEditorAutocompleteProvider(previousEditor) ?? provider;
}
