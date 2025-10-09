const fs = require('fs');
const pdf = require('pdf-parse');

async function extractText() {
    const dataBuffer = fs.readFileSync('./3schemas.pdf');
    const data = await pdf(dataBuffer);
    
    console.log('=== PDF TEXT CONTENT ===\n');
    console.log(data.text);
    console.log('\n=== END ===');
    
    // Save to file for easier viewing
    fs.writeFileSync('./extracted-text.txt', data.text);
    console.log('\nText saved to extracted-text.txt');
}

extractText().catch(console.error);

