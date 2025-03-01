// Centralized logging function
function logError(message, error) {
  console.error(message, error.response ? error.response.data : error);
}

// Date utilities
const dateUtils = {
  getCurrentFormattedDate: () => {
    const now = new Date();
    const options = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      timeZone: 'UTC'
    };
    return now.toLocaleDateString('en-US', options);
  },
  
  getCurrentYear: () => {
    return new Date().getUTCFullYear();
  },
  
  getCurrentMonth: () => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[new Date().getUTCMonth()];
  },
  
  getCurrentDay: () => {
    return new Date().getUTCDate();
  },
  
  getFullUTCDateString: () => {
    const now = new Date();
    return now.toUTCString();
  },
  
  substituteToday(query) {
    const formattedDate = this.getCurrentFormattedDate();
    const currentYear = this.getCurrentYear();
    
    return query.replace(/\btoday\b/gi, formattedDate)
                .replace(/\bcurrent date\b/gi, formattedDate)
                .replace(/\bcurrent year\b/gi, currentYear.toString())
                .replace(/\bthis year\b/gi, currentYear.toString());
  },
  
  overrideDateInQuery(query) {
    const formattedDate = this.getCurrentFormattedDate();
    const currentYear = this.getCurrentYear();
    
    // This regex matches phrases like "as of July 17, 2024" (case-insensitive).
    let result = query.replace(/as of\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}/gi, 'as of ' + formattedDate);
    
    // Also replace any standalone year references that might be outdated
    result = result.replace(/\b(in|for|during|of)\s+2023\b/gi, `$1 ${currentYear}`);
    
    return result;
  },
  
  // Unified function to process all date-related substitutions
  processQuery(query) {
    return this.overrideDateInQuery(this.substituteToday(query));
  }
};

module.exports = {
  logError,
  dateUtils
}; 