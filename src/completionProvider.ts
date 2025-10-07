import * as vscode from 'vscode';

export class KqlCompletionProvider implements vscode.CompletionItemProvider {
    
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        
        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        const completions: vscode.CompletionItem[] = [];

        // Check context
        const afterPipe = /\|\s*\w*$/.test(linePrefix);
        const startOfLine = /^\s*\w*$/.test(linePrefix);
        const afterWhere = /\|\s*where\s+\w*$/.test(linePrefix);
        const afterFieldName = /\|\s*where\s+\w+\s+\w*$/.test(linePrefix);
        const afterComparisonOp = /\|\s*where\s+\w+\s+(==|!=|=~|!~|>|<|>=|<=|contains|startswith|endswith|has|in|between)\s+\w*$/.test(linePrefix);
        const inSummarize = /\|\s*summarize\s/.test(linePrefix) && !linePrefix.endsWith('by ');
        const afterBy = /\bby\s+\w*$/.test(linePrefix);
        const inExtend = /\|\s*extend\s/.test(linePrefix);
        const inLet = /^\s*let\s/.test(linePrefix);
        const afterRender = /\|\s*render\s+\w*$/.test(linePrefix);

        if (startOfLine && !afterPipe) {
            // At start of line - suggest let, table names, or table operators
            completions.push(this.getLetCompletion());
            completions.push(...this.getAzureTableCompletions());
            completions.push(...this.getOperatorCompletions());
        } else if (afterRender) {
            // After render operator - suggest chart types
            completions.push(...this.getRenderChartCompletions());
        } else if (afterPipe) {
            // Right after pipe operator - suggest KQL operators only
            completions.push(...this.getOperatorCompletions());
        } else if (afterComparisonOp) {
            // After comparison operator (contains, ==, etc.) - only scalar functions, NO aggregations
            completions.push(...this.getScalarFunctionCompletions());
        } else if (afterFieldName) {
            // After field name in where clause - suggest comparison operators
            completions.push(...this.getComparisonOperatorCompletions());
        } else if (afterWhere || afterBy) {
            // Right after 'where' or 'by' - don't suggest operators, user needs to type field name
            // Could suggest common field names here in the future
            return [];
        } else if (inLet) {
            // Inside let statement - suggest scalar functions
            completions.push(...this.getScalarFunctionCompletions());
        } else if (inSummarize) {
            // Inside summarize - suggest aggregation functions only
            completions.push(...this.getAggregationFunctionCompletions());
        } else if (inExtend) {
            // Inside extend - suggest scalar functions only
            completions.push(...this.getScalarFunctionCompletions());
        } else {
            // General context - suggest scalar functions (not aggregations outside summarize)
            completions.push(...this.getScalarFunctionCompletions());
        }

        return completions;
    }

    private getLetCompletion(): vscode.CompletionItem {
        const item = new vscode.CompletionItem('let', vscode.CompletionItemKind.Keyword);
        item.detail = 'Define variable';
        item.documentation = new vscode.MarkdownString(
            'Defines a name for an expression. Can be a scalar value, tabular expression, or function.\n\n' +
            'Examples:\n' +
            '```kql\n' +
            'let n = 10;\n' +
            'let startTime = ago(7d);\n' +
            'let MyTable = Events | where Level == "Error";\n' +
            '```'
        );
        item.insertText = 'let ';
        return item;
    }

    private getOperatorCompletions(): vscode.CompletionItem[] {
        const operators = [
            { label: 'where', detail: 'Filter rows', doc: 'Filters rows based on a predicate.\n\nExample: | where State == "TEXAS"' },
            { label: 'project', detail: 'Select columns', doc: 'Selects specific columns to include in the output.\n\nExample: | project Name, Age, City' },
            { label: 'project-away', detail: 'Exclude columns', doc: 'Excludes specified columns from the output.\n\nExample: | project-away InternalId, TempData' },
            { label: 'project-keep', detail: 'Keep only columns', doc: 'Keeps only the specified columns.\n\nExample: | project-keep Name, Email' },
            { label: 'project-rename', detail: 'Rename columns', doc: 'Renames columns in the result set.\n\nExample: | project-rename NewName = OldName' },
            { label: 'project-reorder', detail: 'Reorder columns', doc: 'Reorders columns in the output.\n\nExample: | project-reorder Name, Age, *' },
            { label: 'summarize', detail: 'Aggregate data', doc: 'Produces a table that aggregates the content of the input table.\n\nExample: | summarize count() by State' },
            { label: 'extend', detail: 'Add computed columns', doc: 'Creates calculated columns and appends them to the result set.\n\nExample: | extend FullName = strcat(FirstName, " ", LastName)' },
            { label: 'join', detail: 'Merge rows', doc: 'Merges rows of two tables by matching values of specified columns.\n\nExample: | join kind=inner (Table2) on Key' },
            { label: 'union', detail: 'Combine tables', doc: 'Takes two or more tables and returns the rows of all of them.\n\nExample: | union Table1, Table2' },
            { label: 'order by', detail: 'Sort results', doc: 'Sorts the rows of the input table by one or more columns.\n\nExample: | order by Timestamp desc' },
            { label: 'sort by', detail: 'Sort results', doc: 'Alias for order by. Sorts the rows by one or more columns.\n\nExample: | sort by Name asc' },
            { label: 'take', detail: 'Return N rows', doc: 'Returns up to the specified number of rows.\n\nExample: | take 100' },
            { label: 'limit', detail: 'Limit rows', doc: 'Alias for take. Returns up to the specified number of rows.\n\nExample: | limit 50' },
            { label: 'top', detail: 'Top N rows', doc: 'Returns the first N rows sorted by the specified column.\n\nExample: | top 10 by Timestamp desc' },
            { label: 'distinct', detail: 'Unique rows', doc: 'Returns a table with distinct combinations of the specified columns.\n\nExample: | distinct State, City' },
            { label: 'count', detail: 'Count rows', doc: 'Returns the number of records in the input table.\n\nExample: | count' },
            { label: 'render', detail: 'Visualize results', doc: 'Renders results as a graphical output.\n\nExample: | render timechart' },
            { label: 'mv-expand', detail: 'Expand multi-value', doc: 'Expands multi-value dynamic arrays or property bags into multiple records.\n\nExample: | mv-expand Tags' },
            { label: 'mv-apply', detail: 'Apply subquery', doc: 'Applies a subquery to each record and returns union of results.\n\nExample: | mv-apply Tag to typeof(string) on (where Tag startswith "env")' },
            { label: 'parse', detail: 'Extract fields', doc: 'Evaluates a string expression and parses its value into one or more calculated columns.\n\nExample: | parse Message with "User: " User " logged in"' },
            { label: 'parse-where', detail: 'Parse with filter', doc: 'Like parse, but filters out rows that don\'t match the pattern.\n\nExample: | parse-where Message with "Error: " ErrorMsg' },
            { label: 'evaluate', detail: 'Invoke plugin', doc: 'Invokes a query-language extension (plugin).\n\nExample: | evaluate bag_unpack(DynamicColumn)' },
            { label: 'invoke', detail: 'Invoke function', doc: 'Runs a function on the table that receives it as input.\n\nExample: | invoke MyFunction()' },
            { label: 'as', detail: 'Name result', doc: 'Binds a name to the tabular expression.\n\nExample: | as Temp' },
            { label: 'serialize', detail: 'Mark as serialized', doc: 'Marks the result set as serialized for window functions.\n\nExample: | serialize' },
            { label: 'range', detail: 'Generate table', doc: 'Generates a table with a sequence of values.\n\nExample: | range x from 1 to 10 step 1' },
            { label: 'print', detail: 'Output expression', doc: 'Outputs a single row with one or more scalar expressions.\n\nExample: print now(), "Hello"' },
            { label: 'search', detail: 'Full-text search', doc: 'Searches for text across all columns and tables.\n\nExample: search "error"' },
            { label: 'find', detail: 'Find in tables', doc: 'Finds rows that match a predicate across a set of tables.\n\nExample: find where Message contains "error"' },
            { label: 'lookup', detail: 'Dimension lookup', doc: 'Extends a fact table with values looked-up in a dimension table.\n\nExample: | lookup DimTable on Key' },
            { label: 'make-series', detail: 'Create time series', doc: 'Creates a series of aggregated values along a specified axis.\n\nExample: | make-series Count=count() default=0 on Timestamp step 1h' },
            { label: 'reduce', detail: 'Group similar rows', doc: 'Groups similar strings together.\n\nExample: | reduce by Message' },
            { label: 'sample', detail: 'Random sample', doc: 'Returns a random sample of rows.\n\nExample: | sample 1000' },
            { label: 'sample-distinct', detail: 'Distinct sample', doc: 'Returns a sample containing distinct values.\n\nExample: | sample-distinct 100 of UserId' },
            { label: 'partition', detail: 'Partition and process', doc: 'Partitions records and processes each partition separately.\n\nExample: | partition by State (summarize count())' },
            { label: 'getschema', detail: 'Get table schema', doc: 'Returns the schema of the input table.\n\nExample: | getschema' }
        ];

        return operators.map(op => {
            const item = new vscode.CompletionItem(op.label, vscode.CompletionItemKind.Keyword);
            item.detail = op.detail;
            item.documentation = new vscode.MarkdownString(op.doc);
            item.insertText = op.label;
            return item;
        });
    }

    private getAggregationFunctionCompletions(): vscode.CompletionItem[] {
        const functions = [
            { label: 'count()', detail: 'Count rows', doc: 'Returns the number of records.\n\nExample: summarize count()' },
            { label: 'countif()', detail: 'Conditional count', doc: 'Returns the number of rows for which predicate evaluates to true.\n\nExample: summarize countif(Status == "Failed")' },
            { label: 'sum()', detail: 'Sum values', doc: 'Returns the sum of the values.\n\nExample: summarize sum(Amount)' },
            { label: 'avg()', detail: 'Average', doc: 'Returns the average value.\n\nExample: summarize avg(Price)' },
            { label: 'min()', detail: 'Minimum value', doc: 'Returns the minimum value.\n\nExample: summarize min(Temperature)' },
            { label: 'max()', detail: 'Maximum value', doc: 'Returns the maximum value.\n\nExample: summarize max(Temperature)' },
            { label: 'dcount()', detail: 'Distinct count', doc: 'Returns an estimate of the number of distinct values.\n\nExample: summarize dcount(UserId)' },
            { label: 'make_list()', detail: 'Create array', doc: 'Creates a dynamic array of all values.\n\nExample: summarize make_list(Name)' },
            { label: 'make_set()', detail: 'Create unique array', doc: 'Creates a dynamic array of distinct values.\n\nExample: summarize make_set(Category)' },
            { label: 'make_bag()', detail: 'Create property bag', doc: 'Creates a dynamic property bag from key-value pairs.\n\nExample: summarize make_bag(pack(Key, Value))' },
            { label: 'percentile()', detail: 'Percentile', doc: 'Returns an estimate for the specified percentile.\n\nExample: summarize percentile(ResponseTime, 95)' },
            { label: 'stdev()', detail: 'Standard deviation', doc: 'Returns the standard deviation.\n\nExample: summarize stdev(Value)' },
            { label: 'variance()', detail: 'Variance', doc: 'Returns the variance.\n\nExample: summarize variance(Value)' },
            { label: 'arg_max()', detail: 'Row with max value', doc: 'Returns the row with the maximum value.\n\nExample: summarize arg_max(Timestamp, *)' },
            { label: 'arg_min()', detail: 'Row with min value', doc: 'Returns the row with the minimum value.\n\nExample: summarize arg_min(Price, *)' }
        ];

        return functions.map(func => {
            const item = new vscode.CompletionItem(func.label, vscode.CompletionItemKind.Function);
            item.detail = func.detail;
            item.documentation = new vscode.MarkdownString(func.doc);
            item.insertText = func.label;
            return item;
        });
    }

    private getScalarFunctionCompletions(): vscode.CompletionItem[] {
        const functions = [
            { label: 'ago()', detail: 'Time offset', doc: 'Subtracts the given timespan from the current UTC time.\n\nExample: ago(1d), ago(30m)' },
            { label: 'now()', detail: 'Current time', doc: 'Returns the current UTC datetime.\n\nExample: now()' },
            { label: 'datetime()', detail: 'Parse datetime', doc: 'Converts a string to datetime.\n\nExample: datetime("2024-01-01")' },
            { label: 'timespan()', detail: 'Create timespan', doc: 'Creates a timespan value.\n\nExample: timespan(1d), timespan(2h)' },
            { label: 'format_datetime()', detail: 'Format datetime', doc: 'Formats a datetime according to the specified format.\n\nExample: format_datetime(Timestamp, "yyyy-MM-dd")' },
            { label: 'format_timespan()', detail: 'Format timespan', doc: 'Formats a timespan according to the specified format.\n\nExample: format_timespan(Duration, "HH:mm:ss")' },
            { label: 'startofday()', detail: 'Start of day', doc: 'Returns the start of the day containing the date.\n\nExample: startofday(Timestamp)' },
            { label: 'startofweek()', detail: 'Start of week', doc: 'Returns the start of the week containing the date.\n\nExample: startofweek(Timestamp)' },
            { label: 'startofmonth()', detail: 'Start of month', doc: 'Returns the start of the month containing the date.\n\nExample: startofmonth(Timestamp)' },
            { label: 'startofyear()', detail: 'Start of year', doc: 'Returns the start of the year containing the date.\n\nExample: startofyear(Timestamp)' },
            { label: 'endofday()', detail: 'End of day', doc: 'Returns the end of the day containing the date.\n\nExample: endofday(Timestamp)' },
            { label: 'endofweek()', detail: 'End of week', doc: 'Returns the end of the week containing the date.\n\nExample: endofweek(Timestamp)' },
            { label: 'endofmonth()', detail: 'End of month', doc: 'Returns the end of the month containing the date.\n\nExample: endofmonth(Timestamp)' },
            { label: 'endofyear()', detail: 'End of year', doc: 'Returns the end of the year containing the date.\n\nExample: endofyear(Timestamp)' },
            { label: 'bin()', detail: 'Round down', doc: 'Rounds values down to a multiple of a given bin size.\n\nExample: bin(Timestamp, 1h)' },
            { label: 'strcat()', detail: 'Concatenate strings', doc: 'Concatenates string arguments.\n\nExample: strcat(FirstName, " ", LastName)' },
            { label: 'split()', detail: 'Split string', doc: 'Splits a string into substrings.\n\nExample: split(Path, "/")' },
            { label: 'substring()', detail: 'Extract substring', doc: 'Extracts a substring from a source string.\n\nExample: substring(Text, 0, 10)' },
            { label: 'strlen()', detail: 'String length', doc: 'Returns the length of a string.\n\nExample: strlen(Message)' },
            { label: 'toupper()', detail: 'To uppercase', doc: 'Converts a string to uppercase.\n\nExample: toupper(Name)' },
            { label: 'tolower()', detail: 'To lowercase', doc: 'Converts a string to lowercase.\n\nExample: tolower(Email)' },
            { label: 'tostring()', detail: 'Convert to string', doc: 'Converts input to a string representation.\n\nExample: tostring(Value)' },
            { label: 'toint()', detail: 'Convert to int', doc: 'Converts input to integer.\n\nExample: toint(StringValue)' },
            { label: 'tolong()', detail: 'Convert to long', doc: 'Converts input to long integer.\n\nExample: tolong(StringValue)' },
            { label: 'todouble()', detail: 'Convert to double', doc: 'Converts input to double.\n\nExample: todouble(StringValue)' },
            { label: 'tobool()', detail: 'Convert to bool', doc: 'Converts input to boolean.\n\nExample: tobool(StringValue)' },
            { label: 'iff()', detail: 'Conditional', doc: 'Returns one value if condition is true, another if false.\n\nExample: iff(Status == "OK", 1, 0)' },
            { label: 'case()', detail: 'Multiple conditions', doc: 'Evaluates a list of conditions and returns the first matching result.\n\nExample: case(x > 10, "high", x > 5, "med", "low")' },
            { label: 'isempty()', detail: 'Check if empty', doc: 'Returns true if the argument is empty.\n\nExample: isempty(Name)' },
            { label: 'isnotempty()', detail: 'Check if not empty', doc: 'Returns true if the argument is not empty.\n\nExample: isnotempty(Email)' },
            { label: 'isnull()', detail: 'Check if null', doc: 'Returns true if the argument is null.\n\nExample: isnull(Value)' },
            { label: 'isnotnull()', detail: 'Check if not null', doc: 'Returns true if the argument is not null.\n\nExample: isnotnull(Value)' },
            { label: 'parse_json()', detail: 'Parse JSON', doc: 'Interprets a string as a JSON value.\n\nExample: parse_json(JsonString)' },
            { label: 'extract()', detail: 'Extract with regex', doc: 'Extracts a match for a regular expression from a text string.\n\nExample: extract("\\\\d+", 0, Text)' },
            { label: 'replace()', detail: 'Replace string', doc: 'Replaces all occurrences of a substring.\n\nExample: replace("old", "new", Text)' },
            { label: 'trim()', detail: 'Trim whitespace', doc: 'Removes leading and trailing whitespace.\n\nExample: trim(" text ")' },
            { label: 'array_length()', detail: 'Array length', doc: 'Returns the number of elements in a dynamic array.\n\nExample: array_length(Tags)' },
            { label: 'pack()', detail: 'Create property bag', doc: 'Creates a dynamic property bag from name-value pairs.\n\nExample: pack("name", Name, "age", Age)' },
            { label: 'hourofday()', detail: 'Hour of day', doc: 'Returns the hour of the day (0-23).\n\nExample: hourofday(Timestamp)' },
            { label: 'dayofweek()', detail: 'Day of week', doc: 'Returns the day of the week as a timespan.\n\nExample: dayofweek(Timestamp)' },
            { label: 'dayofmonth()', detail: 'Day of month', doc: 'Returns the day of the month (1-31).\n\nExample: dayofmonth(Timestamp)' },
            { label: 'getmonth()', detail: 'Get month', doc: 'Returns the month number (1-12).\n\nExample: getmonth(Timestamp)' },
            { label: 'getyear()', detail: 'Get year', doc: 'Returns the year.\n\nExample: getyear(Timestamp)' },
            { label: 'hash()', detail: 'Hash function', doc: 'Returns a hash value for the input.\n\nExample: hash(StringValue)' },
            { label: 'hash_sha256()', detail: 'SHA256 hash', doc: 'Returns SHA256 hash of the input.\n\nExample: hash_sha256(StringValue)' },
            { label: 'hash_md5()', detail: 'MD5 hash', doc: 'Returns MD5 hash of the input.\n\nExample: hash_md5(StringValue)' },
            { label: 'parse_ipv4()', detail: 'Parse IPv4 address', doc: 'Parses an IPv4 address to long number.\n\nExample: parse_ipv4("192.168.1.1")' },
            { label: 'parse_ipv4_mask()', detail: 'Parse IPv4 with mask', doc: 'Parses IPv4 address with network mask.\n\nExample: parse_ipv4_mask("192.168.1.0", 24)' },
            { label: 'ipv4_is_private()', detail: 'Check if private IP', doc: 'Checks if IPv4 address is in private range.\n\nExample: ipv4_is_private("192.168.1.1")' },
            { label: 'ipv4_is_in_range()', detail: 'Check IP in range', doc: 'Checks if IPv4 is in specified range.\n\nExample: ipv4_is_in_range("192.168.1.5", "192.168.1.0/24")' },
            { label: 'ipv4_compare()', detail: 'Compare IPv4 addresses', doc: 'Compares two IPv4 addresses.\n\nExample: ipv4_compare("192.168.1.1", "192.168.1.2")' },
            { label: 'parse_ipv6()', detail: 'Parse IPv6 address', doc: 'Parses an IPv6 address.\n\nExample: parse_ipv6("2001:0db8:85a3::8a2e:0370:7334")' },
            { label: 'geo_distance_2points()', detail: 'Distance between points', doc: 'Calculates geographic distance between two points.\n\nExample: geo_distance_2points(lon1, lat1, lon2, lat2)' },
            { label: 'geo_point_in_circle()', detail: 'Point in circle', doc: 'Checks if point is within circle.\n\nExample: geo_point_in_circle(lon, lat, centerLon, centerLat, radius)' },
            { label: 'geo_point_to_s2cell()', detail: 'Convert to S2 cell', doc: 'Converts geographic point to S2 cell.\n\nExample: geo_point_to_s2cell(longitude, latitude)' },
            { label: 'base64_encode_tostring()', detail: 'Base64 encode', doc: 'Encodes string to base64.\n\nExample: base64_encode_tostring("text")' },
            { label: 'base64_decode_tostring()', detail: 'Base64 decode', doc: 'Decodes base64 string.\n\nExample: base64_decode_tostring("dGV4dA==")' },
            { label: 'base64_encode_fromguid()', detail: 'Encode GUID to base64', doc: 'Encodes GUID to base64 string.\n\nExample: base64_encode_fromguid(guid)' },
            { label: 'base64_decode_toguid()', detail: 'Decode base64 to GUID', doc: 'Decodes base64 to GUID.\n\nExample: base64_decode_toguid(base64String)' },
            { label: 'url_encode()', detail: 'URL encode', doc: 'Encodes URL string.\n\nExample: url_encode("hello world")' },
            { label: 'url_decode()', detail: 'URL decode', doc: 'Decodes URL encoded string.\n\nExample: url_decode("hello%20world")' },
            { label: 'parse_url()', detail: 'Parse URL', doc: 'Parses URL into components.\n\nExample: parse_url("https://example.com/path")' },
            { label: 'parse_urlquery()', detail: 'Parse URL query', doc: 'Parses URL query parameters.\n\nExample: parse_urlquery("key1=value1&key2=value2")' },
            { label: 'parse_user_agent()', detail: 'Parse user agent', doc: 'Parses user agent string.\n\nExample: parse_user_agent(UserAgent)' },
            { label: 'parse_version()', detail: 'Parse version', doc: 'Parses version string.\n\nExample: parse_version("1.2.3.4")' },
            { label: 'parse_csv()', detail: 'Parse CSV', doc: 'Parses CSV formatted string.\n\nExample: parse_csv("a,b,c")' },
            { label: 'parse_xml()', detail: 'Parse XML', doc: 'Parses XML string.\n\nExample: parse_xml(XmlString)' },
            { label: 'parse_path()', detail: 'Parse file path', doc: 'Parses file path into components.\n\nExample: parse_path("/folder/file.txt")' },
            { label: 'indexof()', detail: 'Find substring index', doc: 'Returns the index of substring.\n\nExample: indexof("hello world", "world")' },
            { label: 'indexof_regex()', detail: 'Find regex match index', doc: 'Returns index of regex match.\n\nExample: indexof_regex("test123", @"\\d+")' },
            { label: 'strcat_delim()', detail: 'Concatenate with delimiter', doc: 'Concatenates strings with delimiter.\n\nExample: strcat_delim(",", Name, Email)' },
            { label: 'strcat_array()', detail: 'Concatenate array', doc: 'Concatenates array elements.\n\nExample: strcat_array(ArrayField, ",")' },
            { label: 'trim_start()', detail: 'Trim start', doc: 'Removes leading whitespace or characters.\n\nExample: trim_start(" text")' },
            { label: 'trim_end()', detail: 'Trim end', doc: 'Removes trailing whitespace or characters.\n\nExample: trim_end("text ")' },
            { label: 'reverse()', detail: 'Reverse string', doc: 'Reverses string or array.\n\nExample: reverse("hello")' },
            { label: 'repeat()', detail: 'Repeat string', doc: 'Repeats string N times.\n\nExample: repeat("*", 5)' },
            { label: 'replace_regex()', detail: 'Replace with regex', doc: 'Replaces text using regex.\n\nExample: replace_regex(@"\\d+", "X", Text)' },
            { label: 'translate()', detail: 'Translate characters', doc: 'Translates characters in string.\n\nExample: translate("abc", "123", Text)' },
            { label: 'unicode_codepoints_from_string()', detail: 'Get Unicode codepoints', doc: 'Returns array of Unicode codepoints.\n\nExample: unicode_codepoints_from_string("text")' },
            { label: 'unicode_codepoints_to_string()', detail: 'Codepoints to string', doc: 'Converts codepoints to string.\n\nExample: unicode_codepoints_to_string(array)' },
            { label: 'todecimal()', detail: 'Convert to decimal', doc: 'Converts input to decimal.\n\nExample: todecimal(StringValue)' },
            { label: 'totimespan()', detail: 'Convert to timespan', doc: 'Converts input to timespan.\n\nExample: totimespan("1.02:03:04")' },
            { label: 'toguid()', detail: 'Convert to GUID', doc: 'Converts input to GUID.\n\nExample: toguid(StringValue)' },
            { label: 'coalesce()', detail: 'Return first non-null', doc: 'Returns first non-null argument.\n\nExample: coalesce(Field1, Field2, "default")' },
            { label: 'iif()', detail: 'Inline if (alias)', doc: 'Alias for iff(). Conditional expression.\n\nExample: iif(x > 5, "high", "low")' },
            { label: 'array_concat()', detail: 'Concatenate arrays', doc: 'Concatenates multiple arrays.\n\nExample: array_concat(array1, array2)' },
            { label: 'array_slice()', detail: 'Slice array', doc: 'Returns slice of array.\n\nExample: array_slice(Tags, 0, 5)' },
            { label: 'array_split()', detail: 'Split array', doc: 'Splits array into chunks.\n\nExample: array_split(Tags, 10)' },
            { label: 'array_index_of()', detail: 'Find index in array', doc: 'Returns index of element in array.\n\nExample: array_index_of(Tags, "value")' },
            { label: 'array_sum()', detail: 'Sum array values', doc: 'Sums numeric array values.\n\nExample: array_sum(NumberArray)' },
            { label: 'bag_keys()', detail: 'Get property bag keys', doc: 'Returns keys from property bag.\n\nExample: bag_keys(DynamicField)' },
            { label: 'bag_merge()', detail: 'Merge property bags', doc: 'Merges property bags.\n\nExample: bag_merge(bag1, bag2)' },
            { label: 'bag_remove_keys()', detail: 'Remove keys from bag', doc: 'Removes keys from property bag.\n\nExample: bag_remove_keys(bag, dynamic(["key1"]))' },
            { label: 'treepath()', detail: 'Get tree path', doc: 'Returns path in hierarchy.\n\nExample: treepath(id, parentId)' },
            { label: 'row_number()', detail: 'Row number', doc: 'Returns row number within partition.\n\nExample: extend RowNum = row_number()' },
            { label: 'row_rank()', detail: 'Row rank', doc: 'Returns rank within partition.\n\nExample: extend Rank = row_rank()' },
            { label: 'row_dense_rank()', detail: 'Dense rank', doc: 'Returns dense rank within partition.\n\nExample: extend DenseRank = row_dense_rank()' }
        ];

        return functions.map(func => {
            const item = new vscode.CompletionItem(func.label, vscode.CompletionItemKind.Function);
            item.detail = func.detail;
            item.documentation = new vscode.MarkdownString(func.doc);
            item.insertText = func.label;
            return item;
        });
    }

    private getComparisonOperatorCompletions(): vscode.CompletionItem[] {
        const operators = [
            { label: '==', detail: 'Equals', doc: 'Case-sensitive equality.\n\nExample: where Status == "OK"' },
            { label: '!=', detail: 'Not equals', doc: 'Case-sensitive inequality.\n\nExample: where Status != "Error"' },
            { label: '=~', detail: 'Equals (case-insensitive)', doc: 'Case-insensitive equality.\n\nExample: where Status =~ "ok"' },
            { label: '!~', detail: 'Not equals (case-insensitive)', doc: 'Case-insensitive inequality.\n\nExample: where Status !~ "error"' },
            { label: '>', detail: 'Greater than', doc: 'Greater than comparison.\n\nExample: where Count > 100' },
            { label: '<', detail: 'Less than', doc: 'Less than comparison.\n\nExample: where Count < 10' },
            { label: '>=', detail: 'Greater than or equal', doc: 'Greater than or equal comparison.\n\nExample: where Count >= 100' },
            { label: '<=', detail: 'Less than or equal', doc: 'Less than or equal comparison.\n\nExample: where Count <= 10' },
            { label: 'contains', detail: 'String contains', doc: 'Checks if string contains substring (case-insensitive).\n\nExample: where Name contains "test"' },
            { label: '!contains', detail: 'Does not contain', doc: 'Checks if string does not contain substring.\n\nExample: where Name !contains "test"' },
            { label: 'contains_cs', detail: 'Contains (case-sensitive)', doc: 'Case-sensitive contains check.\n\nExample: where Name contains_cs "Test"' },
            { label: 'startswith', detail: 'Starts with', doc: 'Checks if string starts with substring.\n\nExample: where Email startswith "admin"' },
            { label: '!startswith', detail: 'Does not start with', doc: 'Checks if string does not start with substring.\n\nExample: where Email !startswith "test"' },
            { label: 'endswith', detail: 'Ends with', doc: 'Checks if string ends with substring.\n\nExample: where Domain endswith ".com"' },
            { label: '!endswith', detail: 'Does not end with', doc: 'Checks if string does not end with substring.\n\nExample: where Domain !endswith ".com"' },
            { label: 'has', detail: 'Has term', doc: 'Searches for indexed term (fast, case-insensitive).\n\nExample: where Message has "error"' },
            { label: '!has', detail: 'Does not have term', doc: 'Checks that indexed term is not present.\n\nExample: where Message !has "success"' },
            { label: 'has_any', detail: 'Has any term', doc: 'Checks if any of the terms are present.\n\nExample: where Message has_any ("error", "warning")' },
            { label: 'has_all', detail: 'Has all terms', doc: 'Checks if all terms are present.\n\nExample: where Message has_all ("error", "critical")' },
            { label: 'in', detail: 'In list', doc: 'Checks if value is in a list.\n\nExample: where State in ("CA", "NY", "TX")' },
            { label: '!in', detail: 'Not in list', doc: 'Checks if value is not in a list.\n\nExample: where State !in ("CA", "NY")' },
            { label: 'in~', detail: 'In list (case-insensitive)', doc: 'Case-insensitive in check.\n\nExample: where Status in~ ("ok", "warning")' },
            { label: 'between', detail: 'Between values', doc: 'Checks if value is between two values.\n\nExample: where Value between (10 .. 20)' },
            { label: 'matches regex', detail: 'Matches regex', doc: 'Checks if string matches regular expression.\n\nExample: where Email matches regex @"[a-z]+@[a-z]+\\.com"' }
        ];

        return operators.map(op => {
            const item = new vscode.CompletionItem(op.label, vscode.CompletionItemKind.Operator);
            item.detail = op.detail;
            item.documentation = new vscode.MarkdownString(op.doc);
            item.insertText = op.label;
            return item;
        });
    }

    private getKeywordCompletions(): vscode.CompletionItem[] {
        const keywords = [
            { label: 'and', detail: 'Logical AND', doc: 'Logical AND operator.\n\nExample: where x > 5 and y < 10' },
            { label: 'or', detail: 'Logical OR', doc: 'Logical OR operator.\n\nExample: where Status == "OK" or Status == "Warning"' },
            { label: 'not', detail: 'Logical NOT', doc: 'Logical NOT operator.\n\nExample: where not(Status == "Error")' },
            { label: 'by', detail: 'Group by', doc: 'Groups results by the specified columns.\n\nExample: summarize count() by State' },
            { label: 'asc', detail: 'Ascending order', doc: 'Sort in ascending order.\n\nExample: order by Name asc' },
            { label: 'desc', detail: 'Descending order', doc: 'Sort in descending order.\n\nExample: order by Timestamp desc' },
            { label: 'kind=inner', detail: 'Inner join', doc: 'Inner join - returns only matching rows.\n\nExample: join kind=inner' },
            { label: 'kind=leftouter', detail: 'Left outer join', doc: 'Left outer join - returns all left rows.\n\nExample: join kind=leftouter' },
            { label: 'kind=rightouter', detail: 'Right outer join', doc: 'Right outer join - returns all right rows.\n\nExample: join kind=rightouter' },
            { label: 'kind=fullouter', detail: 'Full outer join', doc: 'Full outer join - returns all rows.\n\nExample: join kind=fullouter' }
        ];

        return keywords.map(kw => {
            const item = new vscode.CompletionItem(kw.label, vscode.CompletionItemKind.Keyword);
            item.detail = kw.detail;
            item.documentation = new vscode.MarkdownString(kw.doc);
            item.insertText = kw.label;
            return item;
        });
    }

    private getAzureTableCompletions(): vscode.CompletionItem[] {
        const tables = [
            { label: 'SecurityEvent', detail: 'Windows Security Events', doc: 'Security events from Windows machines.\n\nCommon fields: EventID, Account, Computer, Activity' },
            { label: 'SigninLogs', detail: 'Azure AD Sign-in Logs', doc: 'Azure Active Directory sign-in logs.\n\nCommon fields: UserPrincipalName, IPAddress, Location, ResultType' },
            { label: 'AuditLogs', detail: 'Azure AD Audit Logs', doc: 'Azure Active Directory audit logs.\n\nCommon fields: OperationName, Result, InitiatedBy' },
            { label: 'Heartbeat', detail: 'Agent Heartbeat', doc: 'Heartbeat records from monitoring agents.\n\nCommon fields: Computer, OSType, Version' },
            { label: 'Perf', detail: 'Performance Counters', doc: 'Performance counter data.\n\nCommon fields: Computer, ObjectName, CounterName, CounterValue' },
            { label: 'Event', detail: 'Windows Event Logs', doc: 'Windows event log data.\n\nCommon fields: EventID, EventLog, Computer, RenderedDescription' },
            { label: 'Syslog', detail: 'Linux Syslog', doc: 'Syslog data from Linux machines.\n\nCommon fields: Computer, Facility, SeverityLevel, SyslogMessage' },
            { label: 'SecurityAlert', detail: 'Security Alerts', doc: 'Security alerts from Microsoft Defender.\n\nCommon fields: AlertName, AlertSeverity, CompromisedEntity' },
            { label: 'SecurityIncident', detail: 'Security Incidents', doc: 'Security incidents.\n\nCommon fields: IncidentNumber, Title, Severity, Status' },
            { label: 'EmailEvents', detail: 'Email Events', doc: 'Email events from Microsoft 365 Defender.\n\nCommon fields: SenderFromAddress, RecipientEmailAddress, Subject, DeliveryAction' },
            { label: 'DeviceEvents', detail: 'Device Events', doc: 'Device events from Microsoft 365 Defender.\n\nCommon fields: DeviceName, ActionType, FileName, FolderPath' },
            { label: 'DeviceFileEvents', detail: 'Device File Events', doc: 'File events from devices.\n\nCommon fields: DeviceName, FileName, FolderPath, FileSize' },
            { label: 'DeviceNetworkEvents', detail: 'Device Network Events', doc: 'Network events from devices.\n\nCommon fields: DeviceName, RemoteIP, RemotePort, RemoteUrl' },
            { label: 'DeviceProcessEvents', detail: 'Device Process Events', doc: 'Process events from devices.\n\nCommon fields: DeviceName, ProcessCommandLine, FileName' },
            { label: 'DeviceLogonEvents', detail: 'Device Logon Events', doc: 'Logon events from devices.\n\nCommon fields: DeviceName, AccountName, LogonType' },
            { label: 'IdentityLogonEvents', detail: 'Identity Logon Events', doc: 'Logon events from identity sources.\n\nCommon fields: AccountName, Application, Protocol' },
            { label: 'CloudAppEvents', detail: 'Cloud App Events', doc: 'Events from cloud applications.\n\nCommon fields: Application, ActionType, AccountDisplayName' },
            { label: 'AADNonInteractiveUserSignInLogs', detail: 'Azure AD Non-Interactive Sign-ins', doc: 'Non-interactive Azure AD sign-in logs.\n\nCommon fields: UserPrincipalName, AppId, ResourceDisplayName' },
            { label: 'AADServicePrincipalSignInLogs', detail: 'Service Principal Sign-ins', doc: 'Service principal sign-in logs.\n\nCommon fields: ServicePrincipalName, AppId, IPAddress' },
            { label: 'W3CIISLog', detail: 'IIS Web Server Logs', doc: 'IIS web server logs.\n\nCommon fields: sSiteName, csMethod, csUriStem, scStatus' },
            { label: 'AppServiceHTTPLogs', detail: 'App Service HTTP Logs', doc: 'Azure App Service HTTP logs.\n\nCommon fields: CsMethod, CsUriStem, ScStatus' },
            { label: 'AzureActivity', detail: 'Azure Activity Logs', doc: 'Azure subscription activity logs.\n\nCommon fields: OperationName, ResourceProvider, Caller' },
            { label: 'AzureDiagnostics', detail: 'Azure Diagnostics', doc: 'Azure resource diagnostics.\n\nCommon fields: ResourceType, Category, OperationName' },
            { label: 'CommonSecurityLog', detail: 'Common Event Format Logs', doc: 'CEF format security logs.\n\nCommon fields: DeviceVendor, DeviceProduct, DeviceEventClassID' },
            { label: 'Update', detail: 'Update Management', doc: 'Update management data.\n\nCommon fields: Computer, Title, Classification, UpdateState' },
            { label: 'UpdateSummary', detail: 'Update Summary', doc: 'Update management summary.\n\nCommon fields: Computer, TotalUpdatesMissing, CriticalUpdatesMissing' },
            { label: 'ProtectionStatus', detail: 'Protection Status', doc: 'Antimalware protection status.\n\nCommon fields: Computer, ProtectionStatus, DetectionId' }
        ];

        return tables.map(table => {
            const item = new vscode.CompletionItem(table.label, vscode.CompletionItemKind.Class);
            item.detail = table.detail;
            item.documentation = new vscode.MarkdownString(table.doc);
            item.insertText = table.label;
            return item;
        });
    }

    private getRenderChartCompletions(): vscode.CompletionItem[] {
        const charts = [
            { label: 'timechart', detail: 'Time series chart', doc: 'Displays data as a time series chart.\n\nBest for: Time-based aggregations\n\nExample: | render timechart' },
            { label: 'barchart', detail: 'Bar chart', doc: 'Displays data as a bar chart.\n\nBest for: Comparing categories\n\nExample: | render barchart' },
            { label: 'columnchart', detail: 'Column chart', doc: 'Displays data as a column chart.\n\nBest for: Comparing categories vertically\n\nExample: | render columnchart' },
            { label: 'piechart', detail: 'Pie chart', doc: 'Displays data as a pie chart.\n\nBest for: Showing proportions\n\nExample: | render piechart' },
            { label: 'scatterchart', detail: 'Scatter chart', doc: 'Displays data as a scatter plot.\n\nBest for: Correlation analysis\n\nExample: | render scatterchart' },
            { label: 'areachart', detail: 'Area chart', doc: 'Displays data as an area chart.\n\nBest for: Cumulative trends over time\n\nExample: | render areachart' },
            { label: 'linechart', detail: 'Line chart', doc: 'Displays data as a line chart.\n\nBest for: Trends over time\n\nExample: | render linechart' },
            { label: 'table', detail: 'Table view', doc: 'Displays data in table format.\n\nExample: | render table' },
            { label: 'card', detail: 'Card view', doc: 'Displays a single value as a card.\n\nBest for: KPIs and metrics\n\nExample: | render card' },
            { label: 'pivotchart', detail: 'Pivot chart', doc: 'Displays data as a pivot chart.\n\nExample: | render pivotchart' },
            { label: 'ladderchart', detail: 'Ladder chart', doc: 'Displays data as a ladder chart.\n\nExample: | render ladderchart' },
            { label: 'anomalychart', detail: 'Anomaly chart', doc: 'Displays data with anomaly detection.\n\nExample: | render anomalychart' }
        ];

        return charts.map(chart => {
            const item = new vscode.CompletionItem(chart.label, vscode.CompletionItemKind.EnumMember);
            item.detail = chart.detail;
            item.documentation = new vscode.MarkdownString(chart.doc);
            item.insertText = chart.label;
            return item;
        });
    }
}

