// Test script to verify date logic

function getExpectedNAVDate(testDate = null) {
  const today = testDate || new Date();
  const dayOfWeek = today.getDay();
  
  let daysToSubtract = 1;
  if (dayOfWeek === 1) { // Monday
    daysToSubtract = 3; // Go back to Friday
  } else if (dayOfWeek === 0) { // Sunday
    daysToSubtract = 2; // Go back to Friday
  }
  
  const expectedDate = new Date(today);
  expectedDate.setDate(today.getDate() - daysToSubtract);
  
  return expectedDate;
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${day}-${month}-${year}`;
}

// Test scenarios
console.log('=== Testing Date Logic ===\n');

// Test 1: Regular weekday (Tuesday)
const tuesday = new Date('2026-02-24');
console.log(`Today: Tuesday, ${formatDate(tuesday)}`);
console.log(`Expected NAV Date: ${formatDate(getExpectedNAVDate(tuesday))}`);
console.log('Should be: 23-Feb-2026 (Monday)\n');

// Test 2: Monday
const monday = new Date('2026-02-23');
console.log(`Today: Monday, ${formatDate(monday)}`);
console.log(`Expected NAV Date: ${formatDate(getExpectedNAVDate(monday))}`);
console.log('Should be: 20-Feb-2026 (Friday)\n');

// Test 3: Friday
const friday = new Date('2026-02-27');
console.log(`Today: Friday, ${formatDate(friday)}`);
console.log(`Expected NAV Date: ${formatDate(getExpectedNAVDate(friday))}`);
console.log('Should be: 26-Feb-2026 (Thursday)\n');

// Test 4: Current date
const today = new Date();
console.log(`Today: ${formatDate(today)}`);
console.log(`Expected NAV Date: ${formatDate(getExpectedNAVDate())}`);
console.log('');

// Test date comparison
console.log('=== Testing Date Comparison ===\n');
const mockTableDate = '23-Feb-2026';
const expectedForToday = formatDate(getExpectedNAVDate(new Date('2026-02-24')));
console.log(`Table shows: ${mockTableDate}`);
console.log(`Expected: ${expectedForToday}`);
console.log(`Match: ${mockTableDate === expectedForToday ? '✓ NAV Updated' : '✗ NAV NOT Updated'}`);
