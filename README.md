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

## keyboard commands
Logs are interactively fuzzy-filtered as you type your query.  
Sift also recognizes the following keyboard commands:

 - `CTRL_C`: Kill child process/Exit Sift
 - `TAB`: Toggle between compact and expanded views.
 - `LEFT ARROW`: Move query cursor left.
 - `RIGHT ARROW`: Move query cursor right.
 - `ESCAPE`: Clear query.
 - `UP ARROW`: Scroll up one entry. Pause autoscroll.
 - `DOWN ARROW`: Scroll down one entry. Pause autoscroll.
 - `PAGE_UP`: Scroll up 20 entries. Pause autoscroll.
 - `PAGE_DOWN`: Scroll down 20 entries. Pause autoscroll.
 - `HOME`: Jump to first entry. Pause autoscrscroll.
 - `END`: Jump to last entry and *resume autoscroll*.
 - `SHIFT_UP ARROW`: Increase fuzzy match inclusivity (more results).
 - `SHIFT_DOWN ARROW`: Decrease fuzzy match inclusivity (fewer results).

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

The algorithm is provided by the [farzher/fuzzysort](https://github.com/farzher/fuzzysort/) library. It seems to be biased toward searching filename-like strings, and tends to give much higher scores to matches at the beginning of words, capital letters, after periods, etc. If a query isn't returning the results you want, try relaxing the search threshold with `PAGE UP`.

Non-string datatypes are interpreted as strings during the filtering process.

### operators
More complex queries can be created with unary and binary operators.

 - ` ` (space): Logical AND. Example: `error critical`
 - `,` (comma): Logical OR. Example: `error,warn`
 - The AND operator (space) takes precedence over the OR operator (comma), meaning queries are always written in disjunctive normal form. Example: `error critical,status failed` means `(error && critical) || (status && failed)`.
 - `!` (exclamation point): Exclude
   - `!key:value:`: matches objects with "value", excluding values associated with "key". Example: `!timestamp:2020` returns logs with a value matching `2020` only if the property for that value does not match `timestamp`.
   - `key:!value:`: matches objects with "key" property, if the value of "key" doesn't match "value". Example: `error:!connection` returns logs with a property matching `error` only if the value associated with that property does not match `connection`.

You can also surround part of a query with quotation marks (") to search for a literal string, in case you want to search for a string containing sift operators. This is currently buggy and doesn't work if your query contains more than one quoted string.

## display
The display has three main sections.

At the bottom of the screen is the query prompt.

Above the query prompt is the status bar.  
On the left side of the status bar is the results summary, which contains two numbers separated by a slash (/). The number on the right is the total number of logs ingested into the log database. The number on the left is the number of logs matched by the current query.  
On the right side of the status bar is fuzzy matching threshold. Higher values make the fuzzy string matching algorithm more permissive, resulting in more matched log entries. The default value is 2.

The rest of the screen is the log viewer. Each line represents one log entry:

```
10 [2020-06-10T20:47:47.842Z][info]hello world
```

The first number is the "Log Index", a unique integer identifying the log and indicating when it was ingested into the log database relative to other logs.

If the log entry has a `timestamp` property, it is displayed in the first set of brackets.  
If the log entry has a `level` property, it is displayed in the second set of brackets. If the value of the `level` property is `error`, the line will be colored red. If the value is `warn` it is colored yellow.  
The rest of the line contains the `message` property.

The `timestamp`, `level`, and `message` fields are not displayed in the expanded log view.

# known issues
 - Objects in arrays are not indexed.
 - Queries with more than one pair of quotation marks don't work as intended.

# roadmap
Sift is in very early development, and could be improved by the addition of several features:
 - Log parsing: Support well known log formats. Provide a mechanism to easily add custom parsers through a config file. E.g. nginx log format.
 - Data type awareness: Support the ability to search for values of a given type, and add operators for filtering these data types (e.g. numeric comparison, array operations)
 - Panel display: View multiple queries or streams at once with split window panels. A lot of the UI work is already done for this feature.
 - UI/UX improvements: Support scrolling within large log entries, jump to log, fast and precise scrolling, help/instructions screen, etc.
 - Process control: Pause, interrupt, and attach to processes. Spawn one or more processes interactively. Combine or separate the output from one or more processes into controlled streams.
 - Advanced query management: Add, remove, and toggle custom queries, which are combined with the user's typed query. E.g. always ignore the `timestamp` property in searches, interactively build complex queries as multiple separate queries whose outputs can be independently analyzed.
 - Custom formatting: Support custom formatting and coloring for "simple" and "expanded" log views.
 - Configuration: Many built-in settings should be configurable from the command line or a configuration file.

# changelog
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

