// Test date loop logic
const startYear = 2025;
const startMonth = 9; // October (0-based)
const startDay = 31;

const endYear = 2025;
const endMonth = 10; // November (0-based)
const endDay = 7;

const startDateNum = startYear * 10000 + (startMonth + 1) * 100 + startDay;
const endDateNum = endYear * 10000 + (endMonth + 1) * 100 + endDay;

console.log('Start date num:', startDateNum);
console.log('End date num:', endDateNum);

let currentYear = startYear;
let currentMonth = startMonth;
let currentDay = startDay;

const processedDates = [];

while (true) {
  const currentDateNum = currentYear * 10000 + (currentMonth + 1) * 100 + currentDay;
  if (currentDateNum > endDateNum) break;
  
  const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
  processedDates.push(dateStr);
  console.log('Processing:', dateStr, 'currentDateNum:', currentDateNum);
  
  // Move to next day
  currentDay++;
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  if (currentDay > daysInMonth) {
    currentDay = 1;
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
  }
}

console.log('\nTotal dates processed:', processedDates.length);
console.log('Dates:', processedDates);
