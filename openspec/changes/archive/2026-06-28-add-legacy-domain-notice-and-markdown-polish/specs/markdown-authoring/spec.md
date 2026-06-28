## MODIFIED Requirements

### Requirement: Markdown authoring controls remain convenient

The interviewer markdown editor SHALL provide syntax highlighting for Markdown source, line numbers, active-line feedback, keyboard editing behavior suitable for technical text, and quick toolbar actions for common authoring constructs. Fenced code blocks SHALL receive embedded code highlighting when the language is supported by the editor. The editor SHALL render as an empty editable text block when no markdown has been entered, without instructional placeholder text. Toolbar labels SHALL be user-facing labels rather than raw Markdown punctuation.

#### Scenario: Toolbar inserts a block snippet

- **WHEN** the interviewer clicks a toolbar action for heading, list, quote, link, inline code, fenced code block, or table
- **THEN** the markdown source is updated at the current selection and focus returns to the editor

#### Scenario: Code block toolbar label is clean

- **WHEN** the interviewer sees the fenced-code toolbar action
- **THEN** the button label is `Code` and does not include visible triple backticks

#### Scenario: Empty editor has no placeholder

- **WHEN** the interviewer opens a room with empty markdown briefing text
- **THEN** the markdown source editor is visually empty except for editor chrome such as line numbers

#### Scenario: Markdown source is highlighted while editing

- **WHEN** the interviewer enters a Markdown table, heading, list, quote, or fenced code block
- **THEN** the editor visually highlights Markdown punctuation and structure instead of displaying all source text in one unstyled color

#### Scenario: Fenced code is highlighted while editing

- **WHEN** the interviewer writes a fenced code block with a supported language such as `ts` or `js`
- **THEN** the editor highlights code tokens inside the fenced block while keeping the raw Markdown source editable

#### Scenario: Candidate view remains preview-only

- **WHEN** a candidate opens the room briefing
- **THEN** the candidate sees only the rendered preview and no Markdown source editor
