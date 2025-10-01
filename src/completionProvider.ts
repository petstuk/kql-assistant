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

        if (startOfLine && !afterPipe) {
            // At start of line - suggest let or table operators
            completions.push(this.getLetCompletion());
            completions.push(...this.getOperatorCompletions());
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
            { label: 'getyear()', detail: 'Get year', doc: 'Returns the year.\n\nExample: getyear(Timestamp)' }
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
}

