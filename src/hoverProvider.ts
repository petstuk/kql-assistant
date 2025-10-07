import * as vscode from 'vscode';

export class KqlHoverProvider implements vscode.HoverProvider {
    
    private operatorDocs = new Map<string, { detail: string; doc: string }>([
        ['where', { detail: 'Filter rows', doc: 'Filters rows based on a predicate.\n\n**Syntax:** `| where <predicate>`\n\n**Example:**\n```kql\nStormEvents\n| where State == "TEXAS"\n| where EventType contains "Tornado"\n```' }],
        ['project', { detail: 'Select columns', doc: 'Selects specific columns to include in the output.\n\n**Syntax:** `| project <column1>, <column2>, ...`\n\n**Example:**\n```kql\nStormEvents\n| project StartTime, EventType, State, DamageProperty\n```' }],
        ['project-away', { detail: 'Exclude columns', doc: 'Excludes specified columns from the output.\n\n**Syntax:** `| project-away <column1>, <column2>, ...`\n\n**Example:**\n```kql\nStormEvents\n| project-away InternalId, TempData\n```' }],
        ['summarize', { detail: 'Aggregate data', doc: 'Produces a table that aggregates the content of the input table.\n\n**Syntax:** `| summarize <aggregation> by <grouping_columns>`\n\n**Example:**\n```kql\nStormEvents\n| summarize EventCount = count(), TotalDamage = sum(DamageProperty) by State\n```' }],
        ['extend', { detail: 'Add computed columns', doc: 'Creates calculated columns and appends them to the result set.\n\n**Syntax:** `| extend <column> = <expression>`\n\n**Example:**\n```kql\nStormEvents\n| extend Duration = EndTime - StartTime\n| extend Year = getyear(StartTime)\n```' }],
        ['join', { detail: 'Merge rows', doc: 'Merges rows of two tables by matching values of specified columns.\n\n**Syntax:** `| join kind=<jointype> (<righttable>) on <key>`\n\n**Join kinds:** inner, leftouter, rightouter, fullouter, leftanti, rightanti, leftsemi, rightsemi\n\n**Example:**\n```kql\nTable1\n| join kind=inner (Table2) on Key\n```' }],
        ['order', { detail: 'Sort results', doc: 'Sorts the rows of the input table by one or more columns.\n\n**Syntax:** `| order by <column> [asc|desc]`\n\n**Example:**\n```kql\nStormEvents\n| order by StartTime desc\n```' }],
        ['sort', { detail: 'Sort results', doc: 'Alias for `order by`. Sorts the rows of the input table.\n\n**Syntax:** `| sort by <column> [asc|desc]`\n\n**Example:**\n```kql\nStormEvents\n| sort by DamageProperty desc\n```' }],
        ['take', { detail: 'Return N rows', doc: 'Returns up to the specified number of rows.\n\n**Syntax:** `| take <number>`\n\n**Example:**\n```kql\nStormEvents\n| take 100\n```' }],
        ['limit', { detail: 'Limit rows', doc: 'Alias for `take`. Returns up to the specified number of rows.\n\n**Syntax:** `| limit <number>`\n\n**Example:**\n```kql\nStormEvents\n| limit 50\n```' }],
        ['top', { detail: 'Top N rows', doc: 'Returns the first N rows sorted by the specified column.\n\n**Syntax:** `| top <number> by <column> [asc|desc]`\n\n**Example:**\n```kql\nStormEvents\n| top 10 by DamageProperty desc\n```' }],
        ['union', { detail: 'Combine tables', doc: 'Takes two or more tables and returns the rows of all of them.\n\n**Syntax:** `union <table1>, <table2>, ...`\n\n**Example:**\n```kql\nunion SecurityEvent, SecurityAlert\n| where TimeGenerated > ago(1h)\n```' }],
        ['distinct', { detail: 'Unique rows', doc: 'Returns a table with distinct combinations of the specified columns.\n\n**Syntax:** `| distinct <column1>, <column2>, ...`\n\n**Example:**\n```kql\nStormEvents\n| distinct State, EventType\n```' }],
        ['count', { detail: 'Count rows', doc: 'Returns the number of records in the input table.\n\n**Syntax:** `| count`\n\n**Example:**\n```kql\nStormEvents\n| where State == "TEXAS"\n| count\n```' }],
        ['render', { detail: 'Visualize results', doc: 'Renders results as a graphical output.\n\n**Chart types:** timechart, barchart, columnchart, piechart, scatterchart, areachart, linechart, card, table\n\n**Example:**\n```kql\nStormEvents\n| summarize count() by bin(StartTime, 1d)\n| render timechart\n```' }],
        ['let', { detail: 'Define variable', doc: 'Defines a name for an expression. Can be a scalar value, tabular expression, or function.\n\n**Syntax:** `let <name> = <expression>;`\n\n**Example:**\n```kql\nlet threshold = 100;\nlet recentEvents = StormEvents | where StartTime > ago(7d);\nrecentEvents | where DamageProperty > threshold\n```' }],
        ['mv-expand', { detail: 'Expand multi-value', doc: 'Expands multi-value dynamic arrays or property bags into multiple records.\n\n**Syntax:** `| mv-expand <column>`\n\n**Example:**\n```kql\nTable\n| mv-expand Tags\n| extend Tag = tostring(Tags)\n```' }],
        ['parse', { detail: 'Extract fields', doc: 'Evaluates a string expression and parses its value into one or more calculated columns.\n\n**Syntax:** `| parse <source> with <pattern>`\n\n**Example:**\n```kql\nLogs\n| parse Message with "User: " User " logged in from " Location\n```' }]
    ]);

    private aggregationFunctions = new Map<string, { detail: string; doc: string }>([
        ['count', { detail: 'Count rows', doc: '**count()** - Returns the number of records.\n\n**Syntax:** `count()`\n\n**Example:**\n```kql\nStormEvents\n| summarize TotalEvents = count() by State\n```' }],
        ['countif', { detail: 'Conditional count', doc: '**countif()** - Returns the number of rows for which predicate evaluates to true.\n\n**Syntax:** `countif(<predicate>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize HighDamage = countif(DamageProperty > 100000)\n```' }],
        ['sum', { detail: 'Sum values', doc: '**sum()** - Returns the sum of the values.\n\n**Syntax:** `sum(<expression>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize TotalDamage = sum(DamageProperty) by State\n```' }],
        ['avg', { detail: 'Average', doc: '**avg()** - Returns the average value.\n\n**Syntax:** `avg(<expression>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize AverageDamage = avg(DamageProperty) by EventType\n```' }],
        ['min', { detail: 'Minimum value', doc: '**min()** - Returns the minimum value.\n\n**Syntax:** `min(<expression>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize EarliestEvent = min(StartTime) by State\n```' }],
        ['max', { detail: 'Maximum value', doc: '**max()** - Returns the maximum value.\n\n**Syntax:** `max(<expression>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize LatestEvent = max(StartTime) by State\n```' }],
        ['dcount', { detail: 'Distinct count', doc: '**dcount()** - Returns an estimate of the number of distinct values.\n\n**Syntax:** `dcount(<expression>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize UniqueStates = dcount(State)\n```' }],
        ['make_list', { detail: 'Create array', doc: '**make_list()** - Creates a dynamic array of all values.\n\n**Syntax:** `make_list(<expression>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize EventTypes = make_list(EventType) by State\n```' }],
        ['make_set', { detail: 'Create unique array', doc: '**make_set()** - Creates a dynamic array of distinct values.\n\n**Syntax:** `make_set(<expression>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize UniqueEvents = make_set(EventType) by State\n```' }],
        ['percentile', { detail: 'Percentile', doc: '**percentile()** - Returns an estimate for the specified percentile.\n\n**Syntax:** `percentile(<expression>, <percentile>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize P95_Damage = percentile(DamageProperty, 95)\n```' }],
        ['arg_max', { detail: 'Row with max value', doc: '**arg_max()** - Returns the row with the maximum value.\n\n**Syntax:** `arg_max(<expression>, <return_columns>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize arg_max(StartTime, *) by State\n```' }],
        ['arg_min', { detail: 'Row with min value', doc: '**arg_min()** - Returns the row with the minimum value.\n\n**Syntax:** `arg_min(<expression>, <return_columns>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize arg_min(StartTime, *) by State\n```' }]
    ]);

    private scalarFunctions = new Map<string, { detail: string; doc: string }>([
        ['ago', { detail: 'Time offset', doc: '**ago()** - Subtracts the given timespan from the current UTC time.\n\n**Syntax:** `ago(<timespan>)`\n\n**Examples:** `ago(1d)`, `ago(30m)`, `ago(2h)`\n\n**Example:**\n```kql\nStormEvents\n| where StartTime > ago(7d)\n```' }],
        ['now', { detail: 'Current time', doc: '**now()** - Returns the current UTC datetime.\n\n**Syntax:** `now()`\n\n**Example:**\n```kql\nprint CurrentTime = now()\n```' }],
        ['bin', { detail: 'Round down', doc: '**bin()** - Rounds values down to a multiple of a given bin size.\n\n**Syntax:** `bin(<value>, <roundTo>)`\n\n**Example:**\n```kql\nStormEvents\n| summarize count() by bin(StartTime, 1h)\n```' }],
        ['datetime', { detail: 'Parse datetime', doc: '**datetime()** - Converts a string to datetime.\n\n**Syntax:** `datetime(<string>)`\n\n**Example:**\n```kql\nlet startDate = datetime("2024-01-01");\n```' }],
        ['strcat', { detail: 'Concatenate strings', doc: '**strcat()** - Concatenates string arguments.\n\n**Syntax:** `strcat(<string1>, <string2>, ...)`\n\n**Example:**\n```kql\nStormEvents\n| extend FullLocation = strcat(State, " - ", County)\n```' }],
        ['split', { detail: 'Split string', doc: '**split()** - Splits a string into substrings.\n\n**Syntax:** `split(<string>, <delimiter>)`\n\n**Example:**\n```kql\nTable\n| extend Parts = split(Path, "/")\n```' }],
        ['substring', { detail: 'Extract substring', doc: '**substring()** - Extracts a substring from a source string.\n\n**Syntax:** `substring(<source>, <startIndex>, <length>)`\n\n**Example:**\n```kql\nTable\n| extend Short = substring(LongText, 0, 10)\n```' }],
        ['toupper', { detail: 'To uppercase', doc: '**toupper()** - Converts a string to uppercase.\n\n**Syntax:** `toupper(<string>)`\n\n**Example:**\n```kql\nTable\n| extend UpperName = toupper(Name)\n```' }],
        ['tolower', { detail: 'To lowercase', doc: '**tolower()** - Converts a string to lowercase.\n\n**Syntax:** `tolower(<string>)`\n\n**Example:**\n```kql\nTable\n| extend LowerEmail = tolower(Email)\n```' }],
        ['tostring', { detail: 'Convert to string', doc: '**tostring()** - Converts input to a string representation.\n\n**Syntax:** `tostring(<value>)`\n\n**Example:**\n```kql\nTable\n| extend NumAsString = tostring(Number)\n```' }],
        ['toint', { detail: 'Convert to int', doc: '**toint()** - Converts input to integer.\n\n**Syntax:** `toint(<value>)`\n\n**Example:**\n```kql\nTable\n| extend NumValue = toint(StringValue)\n```' }],
        ['iff', { detail: 'Conditional', doc: '**iff()** - Returns one value if condition is true, another if false.\n\n**Syntax:** `iff(<condition>, <if_true>, <if_false>)`\n\n**Example:**\n```kql\nStormEvents\n| extend Severity = iff(DamageProperty > 10000, "High", "Low")\n```' }],
        ['case', { detail: 'Multiple conditions', doc: '**case()** - Evaluates a list of conditions and returns the first matching result.\n\n**Syntax:** `case(<condition1>, <result1>, <condition2>, <result2>, ..., <default>)`\n\n**Example:**\n```kql\nTable\n| extend Level = case(\n    Value > 100, "High",\n    Value > 50, "Medium",\n    "Low"\n)\n```' }],
        ['parse_json', { detail: 'Parse JSON', doc: '**parse_json()** - Interprets a string as a JSON value.\n\n**Syntax:** `parse_json(<string>)`\n\n**Example:**\n```kql\nTable\n| extend JsonData = parse_json(JsonString)\n| extend Value = JsonData.propertyName\n```' }],
        ['extract', { detail: 'Extract with regex', doc: '**extract()** - Extracts a match for a regular expression from a text string.\n\n**Syntax:** `extract(<regex>, <captureGroup>, <text>)`\n\n**Example:**\n```kql\nTable\n| extend Number = extract(@"\\d+", 0, Text)\n```' }],
        ['format_datetime', { detail: 'Format datetime', doc: '**format_datetime()** - Formats a datetime according to the specified format.\n\n**Syntax:** `format_datetime(<datetime>, <format>)`\n\n**Example:**\n```kql\nTable\n| extend DateString = format_datetime(Timestamp, "yyyy-MM-dd HH:mm")\n```' }],
        ['startofday', { detail: 'Start of day', doc: '**startofday()** - Returns the start of the day containing the date.\n\n**Syntax:** `startofday(<datetime>)`\n\n**Example:**\n```kql\nTable\n| extend DayStart = startofday(Timestamp)\n```' }],
        ['startofweek', { detail: 'Start of week', doc: '**startofweek()** - Returns the start of the week containing the date.\n\n**Syntax:** `startofweek(<datetime>)`\n\n**Example:**\n```kql\nTable\n| extend WeekStart = startofweek(Timestamp)\n```' }],
        ['startofmonth', { detail: 'Start of month', doc: '**startofmonth()** - Returns the start of the month containing the date.\n\n**Syntax:** `startofmonth(<datetime>)`\n\n**Example:**\n```kql\nTable\n| extend MonthStart = startofmonth(Timestamp)\n```' }],
        ['getyear', { detail: 'Get year', doc: '**getyear()** - Returns the year.\n\n**Syntax:** `getyear(<datetime>)`\n\n**Example:**\n```kql\nTable\n| extend Year = getyear(Timestamp)\n```' }],
        ['getmonth', { detail: 'Get month', doc: '**getmonth()** - Returns the month number (1-12).\n\n**Syntax:** `getmonth(<datetime>)`\n\n**Example:**\n```kql\nTable\n| extend Month = getmonth(Timestamp)\n```' }],
        ['hourofday', { detail: 'Hour of day', doc: '**hourofday()** - Returns the hour of the day (0-23).\n\n**Syntax:** `hourofday(<datetime>)`\n\n**Example:**\n```kql\nTable\n| extend Hour = hourofday(Timestamp)\n```' }],
        ['dayofweek', { detail: 'Day of week', doc: '**dayofweek()** - Returns the day of the week as a timespan.\n\n**Syntax:** `dayofweek(<datetime>)`\n\n**Example:**\n```kql\nTable\n| extend DayOfWeek = dayofweek(Timestamp)\n```' }]
    ]);

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        
        const range = document.getWordRangeAtPosition(position, /[\w-]+/);
        if (!range) {
            return undefined;
        }

        const word = document.getText(range).toLowerCase();
        
        // Check operators first
        if (this.operatorDocs.has(word)) {
            const info = this.operatorDocs.get(word)!;
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**${word}** - ${info.detail}\n\n`);
            markdown.appendMarkdown(info.doc);
            markdown.isTrusted = true;
            return new vscode.Hover(markdown, range);
        }

        // Check aggregation functions
        if (this.aggregationFunctions.has(word)) {
            const info = this.aggregationFunctions.get(word)!;
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(info.doc);
            markdown.isTrusted = true;
            return new vscode.Hover(markdown, range);
        }

        // Check scalar functions
        if (this.scalarFunctions.has(word)) {
            const info = this.scalarFunctions.get(word)!;
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(info.doc);
            markdown.isTrusted = true;
            return new vscode.Hover(markdown, range);
        }

        return undefined;
    }
}

