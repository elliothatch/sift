# sift
## Search and filter structured logs interactively in the terminal

Sift is a NodeJs command-line tool that provides an interactive interface for viewing and searching structured log data.  

https://github.com/elliothatch/sift/assets/2262577/a4bbf221-9c6b-47c4-9e8f-d1957699c380

# install
```
npm install -g sift-cli
```
or
```
yarn global add sift-cli
```

# usage
```
sift <exec> [...params]
```

For example:
```
sift node myscript.js
sift cat logs1.txt logs2.txt
```

## data ingestion
On launch, Sift will spawn the child process `<exec>`, passing on any command-line parameters it was provided. Then it redirects STDOUT and STDERR from the child process into sift, ingesting each line as a separate log entry into the in-memory log database.

Currently, Sift only supports line-separated JSON as input. Inputs that fail to parse as JSON are converted into a JSON object with the structure:
```json
{
	"level": "info",
	"message": "[INPUT]"
}
```

Logs ingested from STDERR are always assigned the level `error`, and may override the original value of `level`.

As each log is ingested, it is assigned a unique "Log Index", which is visible in the left column of the log display.

## keyboard commands
To view in-app help, type `\?` (backslash, followed by a question mark).

Sift uses a modal menu system. The default view on start-up is QUERY MODE.

### query mode
Logs are interactively fuzzy-filtered as you type your query. See "query language" below for details.  
Sift also recognizes the following keyboard commands:

 - `CTRL_C`: Kill child process/Exit Sift
 - `UP/DOWN ARROWS`: Move selection
 - `LEFT/RIGHT ARROWS`: Scroll horizontally
 - `ENTER`: Toggle between compact and expanded view of the selected log.
 - `ESCAPE`: Clear query.
 - `PAGE_UP`: Scroll up 20 entries.
 - `PAGE_DOWN`: Scroll down 20 entries.
 - `HOME`: Jump to first entry.
 - `END`: Jump to last entry and *resume auto scroll*.
 - `SHIFT_LEFT/RIGHT ARROWS`: Move query cursor left/right.
 - `CTRL_LEFT/RIGHT ARROWS`: Select previous/next window, when split windows are used.
 - `SHIFT_PAGE_UP`: Increase fuzzy matching threshold, broadening results.
 - `SHIFT_PAGE_DOWN`: Decrease fuzzy matching threshold, narrowing results.
 - `TAB`: Toggle Search/Filter views
 - `CTRL_N`: Jump to next match in search mode
 - `CTRL_P`: Jump to previous match in search mode

Changing the selection with `UP/DOWN/PAGE_UP/PAGE_DOWN/HOME` pauses log auto scrolling. Resume auto scrolling by pressing `END` to jump to the end of the logs.

Pressing `TAB` switches between filter view (default) and search view. In filter view, only logs that match the filter are displayed. In search view, all logs are displayed, and logs that match the filter are highlighted. Use `CTRL_N` and `CTRL_P` to jump to between matches.

See the in-app help page for a list of all key bindings.

### command mode
Press backslash `\` to enter COMMAND MODE and open a menu with additional actions. Press the listed key to perform an action, or press `ESCAPE` or `CTRL_C` to return to QUERY MODE.  
Sift currently supports the following commands:

 - `\`: insert \ into query
 - `f`: Enter filter mode
 - `m`: Enter message formatting mode
 - `c`: close the current log panel
 - `g`: goto log
 - `s`: spawn process
 - `v`: vertically split the current log panel
 - `?`: display help


See the in-app help page for information about all modes.

## query language
Sift uses a simple query language to find and filter JSON objects.

To search all keys and values, just start typing your search.
```bash
> error
```
(matches objects with "error" as a key or value)

You can find logs matching a specific key-value pair by separating the key and value with a colon (:).  
`key:value`

```bash
> level:error
```
(matches all objects with the key "level" whose value matches the string "error")

You can also type the colon but leave off the key or value to do a partial search.  
`key:` or `:value`

```bash
> level:
```
(matches all objects with the key "level")

```bash
> :error
```
(matches all objects with the value "error" on any property)

To search specific keys within an object, use dot notation.
```bash
> node.data
```
(matches all objects with the "node" key whose value is an object with the property "data")

Dot notation works to any depth, and can be combined with a colon to match a specific value.

```bash
> node.data.id:42
```

All queries are matched using a case-insensitive fuzzy string matching algorithm. When you enter a query, each matching property and value across all logs is assigned a score based on how closely it matches the query. Logs are only displayed if the score for each part of the query exceeds the fuzzy matching threshold.

The default threshold has been selected to filter out irrelevant results, without excluding close matches, but in some cases can be too restrictive or permissive, especially for logs containing very long strings. You can make the search more strict with `SHIFT_PAGE UP` or more inclusive with `SHIFT_PAGE DOWN`.

The algorithm is provided by the [farzher/fuzzysort](https://github.com/farzher/fuzzysort/) library. It seems to be biased toward searching filename-like strings, and tends to give much higher scores to matches at the beginning of words, capital letters, after periods, etc. If a query isn't returning the results you want, try relaxing the search threshold.

Non-string datatypes are interpreted as strings during the filtering process.

### operators
More complex queries can be created with unary and binary operators.

 - ` ` (space): Logical AND. Example: `error critical`
 - `,` (comma): Logical OR. Example: `error,warn`
 - The AND operator (space) takes precedence over the OR operator (comma), meaning queries are always written in disjunctive normal form. Example: `error critical,status failed` means `(error && critical) || (status && failed)`.
 - `!` (exclamation point): Exclude
   - `!key:value`: matches objects with "value", excluding values associated with "key". Example: `!timestamp:2020` returns logs with a value matching `2020` only if the property for that value does not match `timestamp`.
   - `key:!value`: matches objects with "key" property, if the value of "key" doesn't match "value". Example: `error:!connection` returns logs with a property matching `error` only if the value associated with that property does not match `connection`.

You can also surround part of a query with quotation marks (") to search for a literal string, in case you want to search for a string containing sift operators. This is currently buggy and doesn't work if your query contains more than one quoted string.

## filters
Filters are customizable, persistent queries that can be toggled on and off to refine a search without needing to retype them every time. They are grouped together and applied to the typed query as an additional AND rule.

There are two types of filter rules: `MATCH` and `FILTER`.
 - `MATCH` rules are joined with "OR". More MATCHES produce a larger result set.
 - `FILTER` rules are joined with "AND". More FILTERS produce a smaller result set.

Access Filter Mode through the command panel by typing `\f`.

## formatting
The single-line text summary for each log is built from a list of text substitution rules. These rules can extract fields from the log's content and display them in various styles and colors, using conditional formatting rules.

The default format is `[{timestamp}][{level}]{message}`, with coloring rules for logs with certain `level` values.
 - `info`: white
 - `warn`: yellow
 - `error`: red
 - `sift`: cyan (`sift` level logs are added by sift, e.g. indicating the process terminate).

 Other logs levels are displayed in a dim gray.

The `timestamp` field is hidden on start-up, and can be enabled by entering Message FormattingMode by typing `\m`.

In the current version of Sift, you cannot create or edit formatting rules.

## split windows
Sift can display multiple log streams at once in split windows. You can also view the same stream in multiple windows at once, with different queries, filters, and formatting rules for each window.

Spawn a process in a new window by typing `\s` and entering a command. Create a vertical split of an existing stream by typing `\v`. Press `CTRL_C` to terminate a running process or to close the window of a stopped process, or type `\c` to close a window without killing the process.

# known issues
 - Queries with more than one pair of quotation marks don't work as intended.


# roadmap
Sift is in very early development, and could be improved by the addition of several features:
 - Log parsing: Support well known log formats. Provide a mechanism to easily add custom parsers through a config file. E.g. nginx log format.
 - Data type awareness: Support the ability to search for values of a given type, and add operators for filtering these data types (e.g. numeric comparison, array operations)
 - Advanced query editor: Interactive query editor for building queries and filters. Save current query directly to a filter.
 - Custom formatting: Support custom formatting and coloring for "simple" and "expanded" log views (renderer uses this already, just needs user configuration).
 - Configuration: Many built-in settings should be configurable from the command line or a configuration file (key-bindings, formatting).
 - Query history: History of queries and commands used to spawn processes.

# changelog
 - 1.2.0: Add search view to jump between filter matches without hiding unfiltered logs. Add `MATCH` and `FILTER` rules to the filters table.
 - 1.1.4: Use standard unicode arrow symbols in controls instead of less supported "Block" arrows
 - 1.1.3: Remove npm-shrinkwrap because it forces devDependencies to install on a global install, with precedence over the rxjs version declared in package.json.
 - 1.1.2: Add fuzzy matching threshold controls. Add basic formatting mode. Fix bugs with scrolling and closing panels. Expand in-app help.
 - 1.1.1: Fix conditional formatting not using query highlighting. Fix typos in README.
 - 1.1.0: Complete overhaul of UI, introducing scrollable selection, command mode, multiple panels, and more. Fixed several bugs, including array items not being indexed, and some logs being printed in the same color as the background.
 - 1.0.11: Fix boolean values not being displayed. When query is changed, enable autoscroll and scroll to last log.
 - 1.0.10: Change keybindings for scrolling, add jump to beginning/end. Non-info level logs messages display as grey instead of white.
 - 1.0.9: Remove `yarn.lock` from published package since it is ignored. Fix terminal-kit version to `1.35.2`
 - 1.0.8: Include `yarn.lock` in published package
 - 1.0.7: Include `npm-shrinkwrap.json` in published package, add package.json `shrinkwrap` script to generate npm-shrinkwrap from yarn.lock
 - 1.0.6: Add SHIFT_UP/SHIFT_DOWN keyboard commands for paged scrolling

# development
## install
```bash
git clone https://github.com/elliothatch/sift.git
cd sift
yarn
```
# build
```bash
yarn build
```

# run
```bash
yarn start <exec>
```

To test against auto-generated data.
```bash
yarn dev
```

# test
```bash
yarn test
```

# publish
Update SIFT_VERSION in `sift.ts`.
```bash
yarn clean
yarn build
yarn test
#yarn shrinkwrap
yarn version
# push changes
yarn publish
```

See package.json for more scripts.

To develop on Windows, you need to change the path in the package.json "build" script to point to the `.cmd` version of tsc. You also need to remove `--enable-source-maps` from the scripts.

