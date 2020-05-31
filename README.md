# sift
## Search and filter structured logs in the terminal

# usage
Sift is a command-line tool that provides an interactive interface to view and filter structured log data.

Press TAB to switch between compact and expanded views.  
Press ESCAPE to clear your query.  

Sift uses a simple query language to find and filter JSON objects.

To search all keys and values, just start typing your search.
```bash
> error
```
(matches objects with "error" as a key or value)


You can find logs matching a specific key-value pair by separating the key and value with a colon (:). `key:value`
```bash
> level:error
```
(matches all objects with the key "level" whose value matches the string "error")

You can also type the colon but leave off the key or value to do a partial search.

```bash
> level:
```
(matches all objects with the key "level")

```bash
> :error
```
(matches all objects with the value "error" on any property)

# Experimental Queries (not functional)
 - `,` (comma): Logical OR
 - ` ` (space): Logical AND
 - `!` (exclamation point): Exclude
   - `!key:value:`: matches objects with "value", excluding values associated with "key"
   - `key:!value:`: matches objects with "key" property, if the value of "key" doesn't match "value"



# install
```bash
yarn
```
# build
```bash
yarn build
```

# run
```bash
yarn start
```

Passing an executable as an argument will fork the executable and redirect its STDOUT and STDERR streams into sift.
```bash
yarn start [executable] [parameters]
```

See package.json for more scripts.
