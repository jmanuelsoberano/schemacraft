import { unavailableComparisonBackend } from "./comparisonBackend";

/** File comparison requires the desktop core; preview mode reports that limitation honestly. */
export const previewComparisonBackend = unavailableComparisonBackend;
