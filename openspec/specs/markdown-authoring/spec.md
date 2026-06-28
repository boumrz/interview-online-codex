# markdown-authoring Specification

## Purpose
Defines Markdown authoring and preview behavior for interview task descriptions, room briefings, dashboard previews, safe rendering, and code highlighting.
## Requirements
### Requirement: Markdown preview supports GFM authoring

The system SHALL render GitHub-flavored Markdown for task descriptions and room briefings, including headings, paragraphs, emphasis, inline code, fenced code blocks, blockquotes, ordered and unordered lists, tables, links, task lists, and automatic line breaks that match common live-preview editor behavior.

#### Scenario: Interviewer writes common Markdown

- **WHEN** an interviewer enters headings, lists, blockquotes, links, inline code, fenced code blocks, and tables in the briefing editor
- **THEN** the live preview renders each structure as formatted HTML instead of plain text or malformed paragraphs

#### Scenario: Dashboard task description is previewed

- **WHEN** a user creates or edits a task description in the dashboard
- **THEN** the preview renders the same Markdown structures as the room briefing preview

### Requirement: Rendered Markdown is sanitized

The system MUST sanitize rendered Markdown output before injecting it into the DOM.

#### Scenario: Markdown contains unsafe HTML

- **WHEN** a user enters HTML such as script tags, event-handler attributes, javascript URLs, or unsafe iframes
- **THEN** the preview removes unsafe content and does not execute scripts

### Requirement: Fenced code blocks are syntax highlighted

The system SHALL syntax-highlight fenced code blocks when the language is known and fall back to escaped plaintext when the language is unknown or omitted.

#### Scenario: Known language fence

- **WHEN** markdown contains a fenced code block such as ` ```ts `
- **THEN** the preview displays a highlighted code block without changing the source markdown

#### Scenario: Unknown language fence

- **WHEN** markdown contains a fenced code block with an unknown language identifier
- **THEN** the preview renders escaped plaintext code without throwing an error

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

### Requirement: Preview styling is readable in dark UI

Rendered Markdown SHALL use a dark-theme readable style with stable spacing, table borders, blockquote treatment, code block scrolling, link color, and no layout overflow on desktop or mobile widths.

#### Scenario: Long code or table content is previewed

- **WHEN** markdown contains long code lines or wide tables
- **THEN** the preview scrolls within the code/table area without breaking the room or dashboard layout

### Requirement: Realtime briefing synchronization is preserved

Changing markdown rendering MUST NOT alter the realtime storage or synchronization contract for `briefingMarkdown`.

#### Scenario: Candidate joins an existing room

- **WHEN** an interviewer has entered markdown briefing content and a candidate joins the room
- **THEN** the candidate receives the same markdown content and sees the rendered preview without seeing the interviewer editor

