const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

async function testExcel() {
  const xlsPath = path.join(__dirname, 'doc', 'LISTA ASISTENCIA REUNION ASAMBLEA 2026.xls');
  console.log('Path:', xlsPath);
  if (!fs.existsSync(xlsPath)) {
    console.error('File not found');
    return;
  }
  
  const workbook = xlsx.readFile(xlsPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  console.log('Rows found:', data.length);
  for (let i = 0; i < Math.min(10, data.length); i++) {
    console.log(`Row ${i}:`, JSON.stringify(data[i]));
  }
}

testExcel();
