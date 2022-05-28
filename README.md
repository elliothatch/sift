# sift
## Search and filter structured logs interactively in the terminal

Sift is a NodeJs command-line tool that provides an interactive interface for viewing and searching structured log data.  

![Sift demonstration](images/demo.gif)

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

Sift uses a modular menu system. The default view on start-up is QUERY MODE.

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

Changing the selection with `UP/DOWN/PAGE_UP/PAGE_DOWN/HOME` pauses log auto scrolling. Resume auto scrolling by pressing `END` to jump to the end of the logs.

### command mode
Press backslash `\` to enter COMMAND MODE and open a menu with additional actions. Press the listed key to perform an action, or press `ESCAPE` or `CTRL_C` to return to QUERY MODE.  
Sift currently supports the following commands:

 - `\`: insert \
 - `f`: Enter filter mode
 - `c`: close the current log panel
 - `g`: goto log
 - `s`: spawn process
 - `v`: split the current log panel into two windows
 - `?`: display help

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

All queries are matched using a case-insensitive fuzzy string matching algorithm. You can make the search more inclusive with `PAGE UP` or more strict with `PAGE DOWN`.

The algorithm is provided by the [farzher/fuzzysort](https://github.com/farzher/fuzzysort/) library. It seems to be biased toward searching filename-like strings, and tends to give much higher scores to matches at the beginning of words, capital letters, after periods, etc. If a query isn't returning the results you want, try relaxing the search threshold (removed for v1.1.0).

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

# known issues
 - Queries with more than one pair of quotation marks don't work as intended.
 - Scrolling with CTRL_E/CTRL_Y uses top-of-window alignment instead of bottom-of-window like all other navigations.
 - Closing the window of a running process without killing the process makes the window unrecoverable, and causes a crash on exit.


# roadmap
Sift is in very early development, and could be improved by the addition of several features:
 - Log parsing: Support well known log formats. Provide a mechanism to easily add custom parsers through a config file. E.g. nginx log format.
 - Data type awareness: Support the ability to search for values of a given type, and add operators for filtering these data types (e.g. numeric comparison, array operations)
 - Advanced query editor: Interactive query editor for building queries and filters. Save current query directly to a filter.
 - Custom formatting: Support custom formatting and coloring for "simple" and "expanded" log views (renderer uses this already, just needs user configuration).
 - Configuration: Many built-in settings should be configurable from the command line or a configuration file (key-bindings, formatting).
 - Query history: History of queries and commands used to spawn processes.

# changelog
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
```bash
yarn clean
yarn build
yarn test
yarn shrinkwrap
yarn version
# push changes
yarn publish
```

See package.json for more scripts.

To develop on Windows, you need to change the path in the package.json "build" script to point to the `.cmd` version of tsc. You also need to remove `--enable-source-maps` from the scripts.

