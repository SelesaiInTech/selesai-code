/** Max characters a special-content reader returns. Large enough for a typical transcript
 *  or a medium PDF; very long documents still truncate (section-aware chunking is future work). */
export const READER_TEXT_CAP = 24000;
