const xlsx = require('xlsx');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const docDir = path.join(__dirname, 'doc');

async function main() {
  console.log('--- LEYENDO EXCEL ---');
  const xlsPath = path.join(docDir, 'LISTA ASISTENCIA REUNION ASAMBLEA 2026.xls');
  if (fs.existsSync(xlsPath)) {
    const workbook = xlsx.readFile(xlsPath);
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    // Print first 10 rows to see structure
    console.log(JSON.stringify(data.slice(0, 10), null, 2));
  } else {
    console.log('Excel file missing');
  }

  console.log('\n--- LEYENDO PDF ---');
  const pdfPath = path.join(docDir, 'CONVOCATORIA ASAMBLEA ORDINARIA MARZO 18 DE 2026.pdf');
  if (fs.existsSync(pdfPath)) {
    const dataBuffer = fs.readFileSync(pdfPath);
    try {
      const data = await pdfParse(dataBuffer);
      console.log(data.text.slice(0, 1000)); // Print first 1000 characters
      console.log('... [texto truncado]');
    } catch (err) {
      console.log('Error pdf:', err.message);
    }
  } else {
    console.log('PDF file missing');
  }
}

main();
