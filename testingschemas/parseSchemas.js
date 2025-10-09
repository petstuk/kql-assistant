const fs = require('fs');
const pdf = require('pdf-parse');

async function parseSchemas(pdfPath) {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const text = data.text;
    
    const schemas = {};
    
    // Split by table sections (each table starts with a name followed by "Article •")
    const sections = text.split(/\n(?=[A-Z][A-Za-z0-9]+\nArticle •)/);
    
    for (const section of sections) {
        if (!section.trim()) continue;
        
        const lines = section.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 2) continue;
        
        // First line is table name
        const tableName = lines[0];
        if (!tableName || tableName.includes('•')) continue;
        
        // Find description (collect all lines until we hit a section header)
        let description = '';
        let descStartIndex = -1;
        
        // Find where description starts (after "Article •" line)
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('Article •')) {
                descStartIndex = i + 1;
                break;
            }
        }
        
        // Collect description lines until we hit a section header
        if (descStartIndex > 0) {
            const sectionHeaders = ['Attribute Value', 'Table attributes', 'Columns', 'Column Type Description', 'Resource types'];
            for (let i = descStartIndex; i < lines.length; i++) {
                const line = lines[i];
                
                // Stop if we hit a section header
                if (sectionHeaders.some(header => line.startsWith(header))) {
                    break;
                }
                
                // Skip empty lines
                if (!line.trim()) continue;
                
                // Add to description
                if (description) {
                    description += ' ' + line;
                } else {
                    description = line;
                }
            }
        }
        
        // Find columns section
        const columnsStartIndex = lines.findIndex(l => l === 'Columns' || l === 'Column Type Description');
        if (columnsStartIndex === -1) continue;
        
        const columns = {};
        
        // Parse columns (format: ColumnName Type Description)
        for (let i = columnsStartIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip section headers
            if (line === 'Expand table' || line === 'Table attributes' || 
                line === 'Columns' || line === 'Column Type Description') {
                continue;
            }
            
            // Match column pattern: starts with letter/underscore, followed by type keyword
            const typeKeywords = ['string', 'int', 'real', 'datetime', 'dynamic', 'bool', 'long', 'decimal', 'timespan'];
            let columnName = null;
            let columnType = null;
            let description = '';
            
            // Try to extract column name and type from the line
            // Description is optional (some columns may not have descriptions)
            for (const typeKeyword of typeKeywords) {
                const pattern = new RegExp(`^([\\w_]+)\\s+(${typeKeyword})\\s*(.*)$`, 'i');
                const match = line.match(pattern);
                if (match) {
                    columnName = match[1];
                    columnType = match[2];
                    description = match[3] || ''; // Default to empty string if no description
                    break;
                }
            }
            
            if (columnName && columnType) {
                columns[columnName] = {
                    type: columnType,
                    description: description
                };
            }
        }
        
        // Only add if we found columns
        if (Object.keys(columns).length > 0) {
            schemas[tableName] = {
                tableName,
                description,
                columns
            };
        }
    }
    
    return schemas;
}

async function main() {
    console.log('Parsing schemas from PDF...\n');
    
    const schemas = await parseSchemas('./allschemas.pdf');
    
    // Display summary
    console.log(`Found ${Object.keys(schemas).length} table schemas:\n`);
    
    for (const [tableName, schema] of Object.entries(schemas)) {
        console.log(`📊 ${tableName}`);
        console.log(`   Description: ${schema.description.substring(0, 80)}...`);
        console.log(`   Columns: ${Object.keys(schema.columns).length}`);
        console.log(`   Sample columns: ${Object.keys(schema.columns).slice(0, 3).join(', ')}\n`);
    }
    
    // Save to JSON
    const outputPath = './extracted-schemas.json';
    fs.writeFileSync(outputPath, JSON.stringify(schemas, null, 2));
    console.log(`\n✅ Schemas saved to ${outputPath}`);
    
    // Display one example
    const firstTable = Object.values(schemas)[0];
    if (firstTable) {
        console.log(`\n📋 Example schema (${firstTable.tableName}):`);
        console.log(JSON.stringify(firstTable, null, 2).substring(0, 500) + '...');
    }
}

main().catch(console.error);

