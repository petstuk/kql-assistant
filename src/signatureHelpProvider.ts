import * as vscode from 'vscode';

export class KqlSignatureHelpProvider implements vscode.SignatureHelpProvider {
    
    private signatures = new Map<string, vscode.SignatureInformation>([
        ['bin', this.createSignature('bin', ['value', 'roundTo'], 'Rounds values down to a multiple of roundTo')],
        ['ago', this.createSignature('ago', ['timespan'], 'Subtracts timespan from current UTC time')],
        ['datetime', this.createSignature('datetime', ['string'], 'Converts string to datetime')],
        ['iff', this.createSignature('iff', ['condition', 'ifTrue', 'ifFalse'], 'Returns ifTrue if condition is true, else ifFalse')],
        ['iif', this.createSignature('iif', ['condition', 'ifTrue', 'ifFalse'], 'Alias for iff(). Returns ifTrue if condition is true, else ifFalse')],
        ['case', this.createSignature('case', ['condition1', 'result1', '...', 'defaultResult'], 'Evaluates conditions and returns first matching result')],
        ['strcat', this.createSignature('strcat', ['string1', 'string2', '...'], 'Concatenates string arguments')],
        ['strcat_delim', this.createSignature('strcat_delim', ['delimiter', 'string1', 'string2', '...'], 'Concatenates strings with delimiter')],
        ['split', this.createSignature('split', ['string', 'delimiter'], 'Splits string into array')],
        ['substring', this.createSignature('substring', ['source', 'startIndex', 'length'], 'Extracts substring from source')],
        ['extract', this.createSignature('extract', ['regex', 'captureGroup', 'text'], 'Extracts regex match from text')],
        ['parse_json', this.createSignature('parse_json', ['jsonString'], 'Parses JSON string to dynamic object')],
        ['parse_xml', this.createSignature('parse_xml', ['xmlString'], 'Parses XML string to dynamic object')],
        ['parse_ipv4', this.createSignature('parse_ipv4', ['ipAddress'], 'Parses IPv4 address to long number')],
        ['parse_ipv4_mask', this.createSignature('parse_ipv4_mask', ['ipAddress', 'prefixLength'], 'Parses IPv4 with network mask')],
        ['ipv4_is_private', this.createSignature('ipv4_is_private', ['ipAddress'], 'Checks if IPv4 is in private range')],
        ['ipv4_is_in_range', this.createSignature('ipv4_is_in_range', ['ipAddress', 'ipRange'], 'Checks if IPv4 is in specified range')],
        ['ipv4_compare', this.createSignature('ipv4_compare', ['ip1', 'ip2'], 'Compares two IPv4 addresses')],
        ['format_datetime', this.createSignature('format_datetime', ['datetime', 'format'], 'Formats datetime according to format string')],
        ['format_timespan', this.createSignature('format_timespan', ['timespan', 'format'], 'Formats timespan according to format string')],
        ['startofday', this.createSignature('startofday', ['datetime', 'offset?'], 'Returns start of day')],
        ['startofweek', this.createSignature('startofweek', ['datetime', 'offset?'], 'Returns start of week')],
        ['startofmonth', this.createSignature('startofmonth', ['datetime', 'offset?'], 'Returns start of month')],
        ['startofyear', this.createSignature('startofyear', ['datetime', 'offset?'], 'Returns start of year')],
        ['endofday', this.createSignature('endofday', ['datetime', 'offset?'], 'Returns end of day')],
        ['endofweek', this.createSignature('endofweek', ['datetime', 'offset?'], 'Returns end of week')],
        ['endofmonth', this.createSignature('endofmonth', ['datetime', 'offset?'], 'Returns end of month')],
        ['endofyear', this.createSignature('endofyear', ['datetime', 'offset?'], 'Returns end of year')],
        ['tostring', this.createSignature('tostring', ['value'], 'Converts value to string')],
        ['toint', this.createSignature('toint', ['value'], 'Converts value to integer')],
        ['tolong', this.createSignature('tolong', ['value'], 'Converts value to long')],
        ['todouble', this.createSignature('todouble', ['value'], 'Converts value to double')],
        ['tobool', this.createSignature('tobool', ['value'], 'Converts value to boolean')],
        ['todecimal', this.createSignature('todecimal', ['value'], 'Converts value to decimal')],
        ['totimespan', this.createSignature('totimespan', ['value'], 'Converts value to timespan')],
        ['toguid', this.createSignature('toguid', ['value'], 'Converts value to GUID')],
        ['count', this.createSignature('count', [], 'Returns count of rows')],
        ['countif', this.createSignature('countif', ['predicate'], 'Returns count of rows where predicate is true')],
        ['sum', this.createSignature('sum', ['expression'], 'Returns sum of expression values')],
        ['sumif', this.createSignature('sumif', ['expression', 'predicate'], 'Returns sum where predicate is true')],
        ['avg', this.createSignature('avg', ['expression'], 'Returns average of expression values')],
        ['avgif', this.createSignature('avgif', ['expression', 'predicate'], 'Returns average where predicate is true')],
        ['min', this.createSignature('min', ['expression'], 'Returns minimum value')],
        ['minif', this.createSignature('minif', ['expression', 'predicate'], 'Returns minimum where predicate is true')],
        ['max', this.createSignature('max', ['expression'], 'Returns maximum value')],
        ['maxif', this.createSignature('maxif', ['expression', 'predicate'], 'Returns maximum where predicate is true')],
        ['dcount', this.createSignature('dcount', ['expression', 'accuracy?'], 'Returns distinct count estimate')],
        ['dcountif', this.createSignature('dcountif', ['expression', 'predicate', 'accuracy?'], 'Returns distinct count where predicate is true')],
        ['percentile', this.createSignature('percentile', ['expression', 'percentile'], 'Returns percentile estimate')],
        ['percentiles', this.createSignature('percentiles', ['expression', 'percentile1', '...'], 'Returns multiple percentiles')],
        ['stdev', this.createSignature('stdev', ['expression'], 'Returns standard deviation')],
        ['stdevif', this.createSignature('stdevif', ['expression', 'predicate'], 'Returns standard deviation where predicate is true')],
        ['variance', this.createSignature('variance', ['expression'], 'Returns variance')],
        ['varianceif', this.createSignature('varianceif', ['expression', 'predicate'], 'Returns variance where predicate is true')],
        ['make_list', this.createSignature('make_list', ['expression', 'maxSize?'], 'Creates dynamic array of all values')],
        ['make_list_if', this.createSignature('make_list_if', ['expression', 'predicate', 'maxSize?'], 'Creates array where predicate is true')],
        ['make_set', this.createSignature('make_set', ['expression', 'maxSize?'], 'Creates dynamic array of distinct values')],
        ['make_set_if', this.createSignature('make_set_if', ['expression', 'predicate', 'maxSize?'], 'Creates distinct array where predicate is true')],
        ['make_bag', this.createSignature('make_bag', ['expression', 'maxSize?'], 'Creates dynamic property bag')],
        ['arg_max', this.createSignature('arg_max', ['expression', 'returnColumns'], 'Returns row with maximum expression value')],
        ['arg_min', this.createSignature('arg_min', ['expression', 'returnColumns'], 'Returns row with minimum expression value')],
        ['pack', this.createSignature('pack', ['key1', 'value1', '...'], 'Creates dynamic property bag from key-value pairs')],
        ['bag_merge', this.createSignature('bag_merge', ['bag1', 'bag2', '...'], 'Merges property bags')],
        ['bag_remove_keys', this.createSignature('bag_remove_keys', ['bag', 'keys'], 'Removes keys from property bag')],
        ['array_length', this.createSignature('array_length', ['array'], 'Returns number of elements in array')],
        ['array_concat', this.createSignature('array_concat', ['array1', 'array2', '...'], 'Concatenates arrays')],
        ['array_slice', this.createSignature('array_slice', ['array', 'start', 'end'], 'Returns slice of array')],
        ['array_split', this.createSignature('array_split', ['array', 'indices'], 'Splits array at indices')],
        ['array_index_of', this.createSignature('array_index_of', ['array', 'value'], 'Returns index of value in array')],
        ['array_sum', this.createSignature('array_sum', ['array'], 'Sums numeric array values')],
        ['replace', this.createSignature('replace', ['oldValue', 'newValue', 'text'], 'Replaces all occurrences')],
        ['replace_regex', this.createSignature('replace_regex', ['regex', 'replacement', 'text'], 'Replaces using regex')],
        ['toupper', this.createSignature('toupper', ['string'], 'Converts to uppercase')],
        ['tolower', this.createSignature('tolower', ['string'], 'Converts to lowercase')],
        ['trim', this.createSignature('trim', ['regex', 'text'], 'Removes leading/trailing characters')],
        ['trim_start', this.createSignature('trim_start', ['regex', 'text'], 'Removes leading characters')],
        ['trim_end', this.createSignature('trim_end', ['regex', 'text'], 'Removes trailing characters')],
        ['strlen', this.createSignature('strlen', ['string'], 'Returns string length')],
        ['indexof', this.createSignature('indexof', ['source', 'lookup', 'start?', 'length?'], 'Returns index of substring')],
        ['indexof_regex', this.createSignature('indexof_regex', ['source', 'regex'], 'Returns index of regex match')],
        ['base64_encode_tostring', this.createSignature('base64_encode_tostring', ['string'], 'Encodes string to base64')],
        ['base64_decode_tostring', this.createSignature('base64_decode_tostring', ['base64String'], 'Decodes base64 to string')],
        ['hash', this.createSignature('hash', ['value', 'mod?'], 'Returns hash value')],
        ['hash_sha256', this.createSignature('hash_sha256', ['value'], 'Returns SHA256 hash')],
        ['hash_md5', this.createSignature('hash_md5', ['value'], 'Returns MD5 hash')],
        ['url_encode', this.createSignature('url_encode', ['url'], 'URL encodes string')],
        ['url_decode', this.createSignature('url_decode', ['url'], 'URL decodes string')],
        ['parse_url', this.createSignature('parse_url', ['url'], 'Parses URL into components')],
        ['parse_urlquery', this.createSignature('parse_urlquery', ['query'], 'Parses URL query parameters')],
        ['parse_version', this.createSignature('parse_version', ['version'], 'Parses version string')],
        ['parse_user_agent', this.createSignature('parse_user_agent', ['userAgent'], 'Parses user agent string')],
        ['parse_csv', this.createSignature('parse_csv', ['csvText'], 'Parses CSV text')],
        ['parse_path', this.createSignature('parse_path', ['path'], 'Parses file path')],
        ['geo_distance_2points', this.createSignature('geo_distance_2points', ['lon1', 'lat1', 'lon2', 'lat2'], 'Calculates distance between two geographic points')],
        ['geo_point_in_circle', this.createSignature('geo_point_in_circle', ['lon', 'lat', 'centerLon', 'centerLat', 'radius'], 'Checks if point is in circle')],
        ['geo_point_to_s2cell', this.createSignature('geo_point_to_s2cell', ['longitude', 'latitude', 'level?'], 'Converts point to S2 cell')],
        ['coalesce', this.createSignature('coalesce', ['value1', 'value2', '...'], 'Returns first non-null value')],
        ['isempty', this.createSignature('isempty', ['value'], 'Checks if value is empty')],
        ['isnotempty', this.createSignature('isnotempty', ['value'], 'Checks if value is not empty')],
        ['isnull', this.createSignature('isnull', ['value'], 'Checks if value is null')],
        ['isnotnull', this.createSignature('isnotnull', ['value'], 'Checks if value is not null')],
        ['row_number', this.createSignature('row_number', [], 'Returns row number within partition')],
        ['row_rank', this.createSignature('row_rank', [], 'Returns rank within partition')],
        ['row_dense_rank', this.createSignature('row_dense_rank', [], 'Returns dense rank within partition')],
        ['repeat', this.createSignature('repeat', ['string', 'count'], 'Repeats string count times')],
        ['reverse', this.createSignature('reverse', ['value'], 'Reverses string or array')],
        ['hourofday', this.createSignature('hourofday', ['datetime'], 'Returns hour of day (0-23)')],
        ['dayofweek', this.createSignature('dayofweek', ['datetime'], 'Returns day of week as timespan')],
        ['dayofmonth', this.createSignature('dayofmonth', ['datetime'], 'Returns day of month (1-31)')],
        ['getmonth', this.createSignature('getmonth', ['datetime'], 'Returns month (1-12)')],
        ['getyear', this.createSignature('getyear', ['datetime'], 'Returns year')],
        ['now', this.createSignature('now', ['offset?'], 'Returns current UTC datetime')]
    ]);

    private createSignature(label: string, parameters: string[], documentation: string): vscode.SignatureInformation {
        const sig = new vscode.SignatureInformation(
            `${label}(${parameters.join(', ')})`,
            new vscode.MarkdownString(documentation)
        );
        sig.parameters = parameters.map(param => 
            new vscode.ParameterInformation(param)
        );
        return sig;
    }

    provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        
        const line = document.lineAt(position.line).text;
        const textBeforeCursor = line.substring(0, position.character);
        
        // Find the function name before the opening parenthesis
        const match = textBeforeCursor.match(/(\w+)\s*\([^)]*$/);
        if (!match) {
            return undefined;
        }

        const functionName = match[1].toLowerCase();
        const signature = this.signatures.get(functionName);
        
        if (!signature) {
            return undefined;
        }

        const signatureHelp = new vscode.SignatureHelp();
        signatureHelp.signatures = [signature];
        signatureHelp.activeSignature = 0;
        
        // Count commas to determine active parameter
        const textInParentheses = textBeforeCursor.substring(textBeforeCursor.lastIndexOf('(') + 1);
        const commaCount = (textInParentheses.match(/,/g) || []).length;
        signatureHelp.activeParameter = Math.min(commaCount, signature.parameters.length - 1);
        
        return signatureHelp;
    }
}

