debugger;

var $ = jQuery.noConflict();

var maxDate, minDate; // will hold the maximum start date and end date of the grid to be used in iterations
NUM_OF_DATA_COLUMNS = 2;
NUM_OF_COLUMNS_AFTER_DATA = 3;
NUM_OF_COLUMNS_AFTER_DATA_FINANCE = 4;

var monthNameList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

var data = API.Context.getData();
var fromStartDate = data.projectStartDate;
var toEndDate = data.projectDueDate;
var projExternalID=data.projExternalID;
var leafTasksIds=formatTaskList(data.leafTasksIds);
var laborBudget = data.laborBudget;
var workItemExternalID = data.currentProject.ExternalID;
var nameOfWorkItem=data.currentProject.name;
var projectRateCard= data.projectRateCard;
var currencyType= data.currentProject.RevenueCurrencyType.name;
var WorkItemtype= data.WorkItemtype;
var dataModel = new Map();
var selectedForecastType;
//will hold the currency exchange table
var exchangeTable;
//will hold the rates table per job title of the project, based on the project rate card
var jobTitlesRateModel;
//Will hold the resource links information of this work item (project/task)
var regularResourceLinkManager;

var projectRemainingForecastFeesModel;

var projectModel;

// counter to track how many times the project-level model builder ran (for debug output)
var projectRemainingForecastBuildCount = 0;
// guard so we print the sample only once after rates are applied
var projectRemainingForecastPrinted = false;
// guard so we print the task sample only once when in Task view
var projectRemainingForecastPrintedTask = false;

var numOfMonths=0;
var effortModelLoaded=false;
var financeModelLoaded=false;

const FORECAST_TYPES = {
    EFFORTS: "efforts",
    FINANCIALS: "financials"
};

const FORECAST_HEADERS = {
    EFFORTS: "Forecast per Resource by Effort (Days)",
    FINANCIALS: "Forecast per Resource by Financials"
};

//left totals headers
const FORECST_TOTLAS_HEADERS = {
    [FORECAST_TYPES.EFFORTS]: ["Work(D)", "Actual Regular Effort (D)","Forecast Effort Balance (D)"],
    [FORECAST_TYPES.FINANCIALS]: ["Budget", "Act. Booked","Remaining Forecast Fees","EAC Fees"]
};

const HOURS_PER_DAY= data.hoursPerDay;
const thisMonday = getThisMondayOrFirstWorkingDay();
const lastDayOfThisMondayMonth = getLastDayOfThisMondayMonth(new Date(thisMonday));
const thisYear = new Date().getFullYear();
const thisMonth = new Date().getMonth() + 1; // Ensure month is 1-12
const firstDateOfNextMonth = getFirstDateOfNextMonth();

class UserRecord {
    constructor(userKey, userDisplayName, vThisMonday,userJobTitle,userJobTitleExternalID,userDiscipline) {
        this.userKey = userKey; // Unique identifier for each user
        this.userDisplayName = userDisplayName;
        this.userDiscipline=userDiscipline;
        this.userJobTitle=userJobTitle;
        this.userJobTitleExternalID= userJobTitleExternalID;
        this.monthlyRecords = new Map(); // Map to hold monthly data records
        this.firstMonthYear = null;
        this.lastMonthYear = null;
        this.thisMonday = vThisMonday; // Date for "This Monday"
        
        // Forecast effort balance variables
        this.forecastTaskAssignmentUntilEOM = 0;
        this.forecastProjectAssignmentUntilEOM = 0;

        // Additions for Budget and Actual Booked
        this.budget = 0;
        this.actualBooked = 0;
        this.exchangeRate = 0;
    }

    // Setters for forecastTaskAssignmentUntilEOM and forecastProjectAssignmentUntilEOM
    setForecastTaskAssignmentUntilEOM(value) {
        this.forecastTaskAssignmentUntilEOM += value;
    }

    setForecastProjectAssignmentUntilEOM(value) {
        this.forecastProjectAssignmentUntilEOM += value;
    }

    // Method to add or update a monthly record, summing values if a record already exists
    addOrUpdateMonthlyRecord(year, month, projectAssignment = 0, taskAssignment = 0, actualApproved = 0) {
        const dateKey = `${year}-${String(month).padStart(2, '0')}`; // Unique key in YYYY-MM format

        if (this.monthlyRecords.has(dateKey)) {
            const existingRecord = this.monthlyRecords.get(dateKey);
            existingRecord.projectAssignment += projectAssignment;
            existingRecord.taskAssignment += taskAssignment;
            existingRecord.actualApproved += actualApproved;
        } else {
            this.monthlyRecords.set(dateKey, { 
                year,
                month,
                projectAssignment: projectAssignment || 0,
                taskAssignment: taskAssignment || 0,
                actualApproved: actualApproved || 0,
                budget: 0,
                actualBooked: 0,
                exchangeRate: 0
            });
            
            if (!this.firstMonthYear || (year < this.firstMonthYear.year) || 
                (year === this.firstMonthYear.year && month < this.firstMonthYear.month)) {
                this.firstMonthYear = { year, month };
            }

            if (!this.lastMonthYear || (year > this.lastMonthYear.year) || 
                (year === this.lastMonthYear.year && month > this.lastMonthYear.month)) {
                this.lastMonthYear = { year, month };
            }
        }
    }

    // Method to add or update monthly record for Budget and Actual Booked
    addOrUpdateMonthlyRecordForFinancials(year, month, budget = 0, actualBooked = 0, exchangeRate = 0) {
        const dateKey = `${year}-${String(month).padStart(2, '0')}`; // Unique key in YYYY-MM format
    
        if (this.monthlyRecords.has(dateKey)) {
            const existingRecord = this.monthlyRecords.get(dateKey);
            
            existingRecord.budget += budget;
            existingRecord.actualBooked += actualBooked;
    
            // Only update exchangeRate if it's currently 0, null, or undefined
            if (!existingRecord.exchangeRate) {
                existingRecord.exchangeRate = exchangeRate;
            }
        } else {
            // Add new record if it doesn't exist
            this.monthlyRecords.set(dateKey, { 
                year,
                month,
                projectAssignment: 0,
                taskAssignment: 0,
                actualApproved: 0,
                budget: budget || 0,
                actualBooked: actualBooked || 0,
                exchangeRate: exchangeRate || 0 
            });
            
            // Update first and last month references if needed
            if (!this.firstMonthYear || (year < this.firstMonthYear.year) || 
                (year === this.firstMonthYear.year && month < this.firstMonthYear.month)) {
                this.firstMonthYear = { year, month };
            }
    
            if (!this.lastMonthYear || (year > this.lastMonthYear.year) || 
                (year === this.lastMonthYear.year && month > this.lastMonthYear.month)) {
                this.lastMonthYear = { year, month };
            }
        }
    }
    

    // Method to get a monthly record by year and month
    getMonthlyRecord(year, month) {
        const dateKey = `${year}-${String(month).padStart(2, '0')}`;
        return this.monthlyRecords.get(dateKey) || null;
    }

    // Calculate total for a field from a specific year and month to the latest month in records
    calculateTotalFrom(field, startYear, startMonth) {
        let total = 0;
        for (const record of this.monthlyRecords.values()) {
            if ((record.year > startYear) || 
                (record.year === startYear && record.month >= startMonth)) {
                total += record[field] || 0;
            }
        }
        return total;
    }

    // Optional: Method to calculate total assignment or actual approved values over all months
    calculateTotal(field) {
        let total = 0;
        for (const record of this.monthlyRecords.values()) {
            total += record[field] || 0;
        }
        return total;
    }

    calculateTotalWithExchangeRate(field) {
        let total = 0;
        for (const record of this.monthlyRecords.values()) {
            total += convertValueUsingExchangeRate(record[field],record.exchangeRate) || 0;
        }
        return total;
    }

    //will return the forecast Task Assignment Until End of Month plus all the forecast from next month until the end period 
    getForecastEffortBalanceTaskAssignment(){
        const nextMonthInfo = getNextMonthYear(new Date(this.thisMonday));
        const totalTaskAssignmentUntilEnd = this.calculateTotalFrom("taskAssignment", nextMonthInfo.year, nextMonthInfo.month);
        return this.forecastTaskAssignmentUntilEOM + totalTaskAssignmentUntilEnd;
    }

    //will return the forecast Project Assignment Until End of Month plus all the forecast from next month until the end period
    getForecastEffortBalanceProjectAssignment() {
        const nextMonthInfo = getNextMonthYear(new Date(this.thisMonday));
        const totalProjectAssignmentUntilEnd = this.calculateTotalFrom("projectAssignment", nextMonthInfo.year, nextMonthInfo.month);
        return this.forecastProjectAssignmentUntilEOM + totalProjectAssignmentUntilEnd;
    }

    // will get this month and year job title rate and the effort left until the end of this month and return the fees
    getRemainingForecastFeesProjectAssignmentUntilEOM(){
        let exchangeRate=0;
        //get currency exchange
        if (currencyType !== "AUD") {
            //exchangeTable.getExchangeRateForCurrencyAndMonth("USD", 12, 2021))
            exchangeRate= exchangeTable.getExchangeRateForCurrencyAndMonth(currencyType,thisMonth,thisYear);
        } else {
            exchangeRate=1;
        }

        let JobTitlerates = jobTitlesRateModel.getRates(this.userJobTitleExternalID, thisMonth, thisYear);
        let projAssignmentUtliEOM=this.forecastProjectAssignmentUntilEOM*HOURS_PER_DAY;
        let retVal = projAssignmentUtliEOM*JobTitlerates.regularRate.value*exchangeRate; 
        return retVal;
    }

    // will get this month and year job title rate and the effort left until the end of this month and return the fees
    getRemainingForecastFeesTaskAssignmentUntilEOM(){
        let exchangeRate=0;
        if (currencyType !== "AUD") {
            //exchangeTable.getExchangeRateForCurrencyAndMonth("USD", 12, 2021))
            exchangeRate= exchangeTable.getExchangeRateForCurrencyAndMonth(currencyType,thisMonth,thisYear);
        } else {
            exchangeRate=1;
        }
        let JobTitlerates = jobTitlesRateModel.getRates(this.userJobTitleExternalID, thisMonth, thisYear);      
        let taskAssignmentUtliEOM=this.forecastTaskAssignmentUntilEOM*HOURS_PER_DAY;
        if(JobTitlerates.regularRate.currency!=="AUD"){//rate is already in a diffrent currency
            exchangeRate=1;
        } 
        let retVal = taskAssignmentUtliEOM*JobTitlerates.regularRate.value*exchangeRate; 
        return retVal;
    }

    // Calculate total Remaining Forecast Fees for a field from a specific year and month to the latest month in records
    //take the rate of the job title per month and year and add to the calculation
    calculateTotalRemainingForecastFeesFrom(field, startYear, startMonth) {
        let total = 0;
        let exchangeRate=0;

        for (const record of this.monthlyRecords.values()) {
            if ((record.year > startYear) || 
                (record.year === startYear && record.month >= startMonth)) {
                if (currencyType !== "AUD") {
                       //exchangeTable.getExchangeRateForCurrencyAndMonth("USD", 12, 2021))
                        exchangeRate= exchangeTable.getExchangeRateForCurrencyAndMonth(currencyType, record.month,record.year);
                } else {
                        exchangeRate=1;
                }
                let JobTitlerates = jobTitlesRateModel.getRates(this.userJobTitleExternalID, record.month, record.year);   
                if(JobTitlerates.regularRate.currency!=="AUD"){//rate is already in a diffrent currency
                    exchangeRate=1;
                } 
                let effortInDays= record[field]*HOURS_PER_DAY;

                total += (effortInDays*JobTitlerates.regularRate.value *exchangeRate|| 0);
            }
        }
        return total;
    }


    //will return the Remaining Forecast Fees based Task Assignment Until End of Month plus all the Remaining Forecast Fees from next month until the end period 
    getRemainingForecastFeesTaskAssignment(){
        const nextMonthInfo = getNextMonthYear(new Date(this.thisMonday));
        const totalTaskAssignmentUntilEnd = this.calculateTotalRemainingForecastFeesFrom("taskAssignment", nextMonthInfo.year, nextMonthInfo.month);
        return this.getRemainingForecastFeesTaskAssignmentUntilEOM() + totalTaskAssignmentUntilEnd;
    }

    //will return the Remaining Forecast Fees based on Project Assignment Until End of Month plus all the Remaining Forecast Fees from next month until the end period
    getRemainingForecastFeesProjectAssignment() {
        const nextMonthInfo = getNextMonthYear(new Date(this.thisMonday));
        const totalProjectAssignmentUntilEnd = this.calculateTotalRemainingForecastFeesFrom("projectAssignment", nextMonthInfo.year, nextMonthInfo.month);
        return this.getRemainingForecastFeesProjectAssignmentUntilEOM() + totalProjectAssignmentUntilEnd;
    }
}


class CurrencyExchangeRecord {
    constructor(id, baseCurrency, quoteCurrency, effectiveFrom, exchangeRate) {
        this.id = id;
        this.baseCurrency = baseCurrency;
        this.quoteCurrency = quoteCurrency;
        this.effectiveFrom = effectiveFrom ? new Date(effectiveFrom) : null;
        this.exchangeRate = exchangeRate;
    }
    // Getter for the ID
    getId() {
        return this.id;
    }

    // Getter for the base currency
    getBaseCurrency() {
        return this.baseCurrency;
    }

    // Getter for the quote currency
    getQuoteCurrency() {
        return this.quoteCurrency;
    }

    // Getter for the effective date
    getEffectiveFrom() {
        return this.effectiveFrom;
    }

    // Getter for the exchange rate
    getExchangeRate() {
        return this.exchangeRate;
    }
}

class CurrencyExchange {
    constructor() {
        this.records = [];
        this.defaultExchangeRates = {};  // Store default rates by quoteCurrency
    }
    // Method to add an exchange rate record with filters
    addRecord(record) {
        // Handle default rate when effectiveFrom is null
        if (record.effectiveFrom === null) {
            this.defaultExchangeRates[record.quoteCurrency] = record.exchangeRate;
            return; // Skip adding this record to the main list
        }

        // Filter out records with EffectiveFrom before the year 2000
        if (record.effectiveFrom.getFullYear() < 2000) {
            return; // Skip this record
        }

        this.records.push(record);
        this.records.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    }

    // Method to get the most recent exchange rate for a given currency and month
    getExchangeRateForCurrencyAndMonth(currency, month, year) {
        const targetDate = new Date(year, month - 1, 1); 
    
        // Filter records for the specified base and quote currency
        const filteredRecords = this.records.filter(rate => 
            rate.baseCurrency === "AUD" && rate.quoteCurrency === currency
        );
    
        if (filteredRecords.length === 0) {
            // No records found for the currency; return the default rate if it exists
            return this.defaultExchangeRates[currency] || 0;
        }
    
        // Sort filtered records by effectiveFrom in ascending order (if not already sorted)
        filteredRecords.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    
        // Iterate through sorted records to find the appropriate rate
        for (let i = 0; i < filteredRecords.length; i++) {
            const currentRate = filteredRecords[i];
            const nextRate = filteredRecords[i + 1];
    
            // Check if targetDate falls within the current effective period
            if (targetDate >= currentRate.effectiveFrom && 
                (!nextRate || targetDate < nextRate.effectiveFrom)) {
                return currentRate.exchangeRate; // Return the rate for the matching period
            }
        }
    
        // If no valid period was found, return the latest rate or the default rate
        const latestRate = filteredRecords[filteredRecords.length - 1];
        return latestRate.exchangeRate || this.defaultExchangeRates[currency] || 0;
    }
    
}

//will hold the job titles rates record of the project based on the rate card
class RateRecord {
    constructor(
        id,
        jobTitleName,
        externalId,
        rateTypeName,
        effectiveFrom,
        effectiveTo,
        regularRateValue,
        regularRateCurrency,
        overtimeRateValue,
        overtimeRateCurrency
    ) {
        this.id = id;
        this.jobTitle = jobTitleName; // Job title name, e.g., "Senior Consultant"
        this.externalId = externalId; // External ID, e.g., "C2 "
        this.rateType = rateTypeName; // Rate type, e.g., "Revenue"
        this.effectiveFrom = new Date(effectiveFrom);
        this.effectiveTo = new Date(effectiveTo);
        this.regularRate = {
            value: regularRateValue,
            currency: regularRateCurrency,
        };
        this.overtimeRate = {
            value: overtimeRateValue,
            currency: overtimeRateCurrency,
        };

        // Flag to mark if this is a default record
        this.isDefault = this.isDefaultRate(effectiveFrom, effectiveTo);
    }

    // Check if both dates are unreasonable, indicating a default rate
    isDefaultRate(effectiveFrom, effectiveTo) {
        const minDate = new Date("1900-01-01");
        const maxDate = new Date("2100-01-01");
        return new Date(effectiveFrom) < minDate && new Date(effectiveTo) > maxDate;
    }

    // Validate if a single date is within a reasonable range
    isValidDate(date) {
        const minDate = new Date("1900-01-01");
        const maxDate = new Date("2100-01-01");
        return date >= minDate && date <= maxDate;
    }

    appliesToDate(targetDate) {
        // Case 1: No valid effectiveFrom date
        if (!this.isValidDate(this.effectiveFrom)) {
            return targetDate <= this.effectiveTo;  // If missing start date, check if the target date is before effectiveTo
        }
    
        // Case 2: No valid effectiveTo date
        if (!this.isValidDate(this.effectiveTo)) {
            return targetDate >= this.effectiveFrom;  // If missing end date, check if the target date is after effectiveFrom
        }
    
        // Case 3: Both dates are valid, check if the targetDate falls within the range
        return targetDate >= this.effectiveFrom && targetDate <= this.effectiveTo;
    }
    
}


//will hold the all the job titles rates records of the project based on the rate card
class RateModel {
    constructor() {
        this.recordsByExternalId = new Map(); // Store records grouped by externalId
    }

      // Add a new rate record to the model
      addRecord(record) {
        if (!this.recordsByExternalId.has(record.externalId)) {
            this.recordsByExternalId.set(record.externalId, []);
        }
        this.recordsByExternalId.get(record.externalId).push(record);
    }
  // Finalize records by filling in missing effectiveTo dates and ensuring valid ranges
  finalizeRecords() {
    for (const [externalId, records] of this.recordsByExternalId.entries()) {
        // Sort valid records, placing default records at the end
        records.sort((a, b) => {
            const aValid = a.isValidDate(a.effectiveFrom);
            const bValid = b.isValidDate(b.effectiveFrom);
            if (!aValid && !bValid) return 0;
            if (!aValid) return 1;
            if (!bValid) return -1;
            return a.effectiveFrom - b.effectiveFrom;
        });

        for (let i = 0; i < records.length - 1; i++) {
            const currentRecord = records[i];
            const nextRecord = records[i + 1];

            if (!currentRecord.isValidDate(currentRecord.effectiveTo)) {
                // Set effectiveTo to the day before the next record's effectiveFrom
                currentRecord.effectiveTo = new Date(nextRecord.effectiveFrom);
                currentRecord.effectiveTo.setDate(currentRecord.effectiveTo.getDate() - 1);
            }
        }

        // Set effectiveTo for the last record if it's not valid
        const lastRecord = records[records.length - 1];
        if (!lastRecord.isValidDate(lastRecord.effectiveTo)) {
            lastRecord.effectiveTo = new Date("2100-01-01"); // Maximum future date
        }
    }
}


    /*
    The getRates function in the RateModel class is designed to retrieve the regular and overtime rates for a specific job title (externalId) at a given month and year.
     It works by checking a collection of RateRecord objects associated with that job title and selecting the appropriate rate based on the specified date.
    */
    getRates(externalId, month, year) {
        const targetDate = new Date(year, month - 1, 1);
        const records = this.recordsByExternalId.get(externalId) || [];
    
        let selectedRecord = null;
    
        for (const record of records) {
            if (record.appliesToDate(targetDate)) {
                selectedRecord = record;
                break; // Found the applicable rate
            }
        }
    
        // If no specific rate found, return the last valid record (default fallback)
        if (!selectedRecord && records.length > 0) {
            selectedRecord = records[records.length - 1];
        }
    
        return selectedRecord
            ? {
                regularRate: {
                    value: selectedRecord.regularRate.value,
                    currency: selectedRecord.regularRate.currency,
                },
                overtimeRate: {
                    value: selectedRecord.overtimeRate.value,
                    currency: selectedRecord.overtimeRate.currency,
                },
            }
            : {
                regularRate: { value: 0, currency: '' },
                overtimeRate: { value: 0, currency: '' },
            };
    }
    

}

RateRecord.prototype.print = function() {
    console.log(`ID: ${this.id}`);
    console.log(`Job Title: ${this.jobTitle}`);
    console.log(`External ID: ${this.externalId}`);
    console.log(`Rate Type: ${this.rateType}`);
    console.log(`Effective From: ${this.effectiveFrom.toISOString().split('T')[0]}`);
    console.log(`Effective To: ${this.effectiveTo.toISOString().split('T')[0]}`);
    console.log(`Regular Rate: ${this.regularRate.value} ${this.regularRate.currency}`);
    console.log(`Overtime Rate: ${this.overtimeRate.value} ${this.overtimeRate.currency}`);
    console.log(`Is Default: ${this.isDefaultRate ? 'Yes' : 'No'}`);
    console.log('-----------------------------');
};

RateModel.prototype.print = function() {
    console.log("=== Rate Model Contents ===");
    for (const [externalId, records] of this.recordsByExternalId.entries()) {
        console.log(`Job Title External ID: ${externalId}`);
        console.log(`Number of Records: ${records.length}`);
        records.forEach(record => {
            record.print();
        });
    }
};

/*=========================================== Regular Resource Link Model Start ==== */

//will hold the resource link structure to enable the save of the data on the link 
class RegularResourceLink {
    constructor(externalid, resourceExternalID, displayName, workItemExternalID, workItemSYSID, workItemName) {
        this.externalid = externalid; // The resource link external ID
        this.resourceExternalID = resourceExternalID; // Resource external ID
        this.displayName = displayName; // Resource display name
        this.workItemExternalID = workItemExternalID; // Work item external ID
        this.workItemSYSID = workItemSYSID; // Work item system ID
        this.workItemName = workItemName; // Work item name
    }
}

// Will hold all the resource links and IDs
class RegularResourceLinkManager {
    constructor() {
        this.links = [];
        this.externalIDMap = new Map(); // To maintain uniqueness by externalid
    }

    addRecord(externalid, resourceExternalID, displayName, workItemExternalID, workItemSYSID, workItemName) {
        if (!this.externalIDMap.has(externalid)) {
            const newLink = new RegularResourceLink(externalid, resourceExternalID, displayName, workItemExternalID, workItemSYSID, workItemName);
            this.links.push(newLink);
            this.externalIDMap.set(externalid, newLink);
        }
    }

    getExternalIDByResourceExternalID(resourceExternalID, workItemExternalID) {
        for (let link of this.links) {
            if (link.resourceExternalID === resourceExternalID && link.workItemExternalID === workItemExternalID) {
                return link.externalid;
            }
        }
        return null; // Return null if not found
    }
}
/*=========================================== Regular Resource Link Model End ==== */

/*=========================================== Project Forecast Model Start ==== */
class ProjectRemainingForecastFeesModel {
    constructor() {
        // Internal map to store work items with unique external IDs
        this.workItems = new Map();
    }

    // Add or update a work item
    addOrUpdateWorkItem(externalID, workItemSysId, workItemName) {
        if (!this.workItems.has(externalID)) {
            this.workItems.set(externalID, new WorkItemRecord(externalID, workItemSysId, workItemName));
        }
        return this.workItems.get(externalID);
    }

    // Get a work item by its external ID
    getWorkItem(externalID) {
        return this.workItems.get(externalID);
    }
    // Method to update rates for all year-month records
    updateRatesInYearMonthlyRecords() {
        // Iterate through each work item in the project model
        for (let [workItemID, workItemRecord] of this.workItems.entries()) {
            // Iterate through each resource link in the work item
            for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
                // Iterate through each year-month record in the resource link
                for (let yearMonthlyRecord of resourceLinkRecord.yearMonthlyRecords) {
                    // Extract year and month from the record
                    const { year, month } = yearMonthlyRecord;
                    // Call getRates with jobTitleExternalID, month, and year
                    const rate = jobTitlesRateModel.getRates(resourceLinkRecord.jobTitleExternalID, month, year);
                    // Set the rate in the YearMonthlyRecord
                    yearMonthlyRecord.rate = {
                        regularRate: {
                            value: rate.regularRate.value,
                            currency: rate.regularRate.currency
                        },
                        overtimeRate: {
                            value: rate.overtimeRate.value,
                            currency: rate.overtimeRate.currency
                        }
                    };

                }
            }
        }
    }

    // Overwrite current-month assignmentInDays from the UI dataModel's forecast values
    syncThisMonthFromDataModel() {
        try {
            for (let [workItemID, workItemRecord] of this.workItems.entries()) {
                for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
                    // Try several user key formats to locate the authoritative UserRecord in dataModel
                    const candidates = [];
                    if (resourceLinkRecord.resourceExternalId) {
                        candidates.push('/User/' + resourceLinkRecord.resourceExternalId);
                        candidates.push(resourceLinkRecord.resourceExternalId);
                        // sometimes the id may already include the prefix
                        if (resourceLinkRecord.resourceExternalId.indexOf('/User/') === 0) {
                            candidates.push(resourceLinkRecord.resourceExternalId);
                        }
                    }

                    let userRecord = null;
                    for (const c of candidates) {
                        if (!c) continue;
                        const ur = dataModel.get(c);
                        if (ur) { userRecord = ur; break; }
                    }

                    if (!userRecord) {
                        // Not found — log for debugging so we can identify mismatched keys
                        // Keep silent in normal runs, but warn in debug sessions
                        // console.warn(`syncThisMonthFromDataModel: no UserRecord for resourceExternalId='${resourceLinkRecord.resourceExternalId}', workItem='${workItemID}'`);
                        continue;
                    }

                    // Choose the forecast field based on laborBudget
                    // Do NOT overwrite per-link assignment values sourced from the daily query.
                    // The daily model is authoritative for per-assignment current-month values.
                    // We only mark existing yearMonthlyRecords as current month so downstream logic
                    // knows which records correspond to the current month.
                    for (let yrRec of resourceLinkRecord.yearMonthlyRecords) {
                        if (yrRec.year === thisYear && yrRec.month === thisMonth) {
                            yrRec.isCurrentMonth = true;
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Error syncing project model current month with dataModel', e);
        }
    }

      // Update currency exchange for all YearMonthlyRecords
      updateCurrencyExchanges() {
        if (typeof exchangeTable === 'undefined' || typeof exchangeTable.getExchangeRateForCurrencyAndMonth !== 'function') {
            console.error("Global variable 'exchangeTable' or its method 'getExchangeRateForCurrencyAndMonth' is not defined.");
            return;
        }

        // Iterate through each work item
        for (let [workItemID, workItemRecord] of this.workItems.entries()) {
            // Iterate through each resource link in the work item
            for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
                // Iterate through each year-month record in the resource link
                for (let yearMonthlyRecord of resourceLinkRecord.yearMonthlyRecords) {
                    // Extract year and month
                    const { year, month } = yearMonthlyRecord;

                    // Fetch the exchange rate using the global exchangeTable
                    const exchangeRate = exchangeTable.getExchangeRateForCurrencyAndMonth(
                        currencyType, // Assuming this is the currency type
                        month,
                        year
                    );

                    // Update the currency exchange in the YearMonthlyRecord
                    yearMonthlyRecord.currencyExchange = exchangeRate;
                }
            }
        }
    }

        // Update ResourceLinkExternalID for ResourceLinkRecords based on resource and work item external id's
        updateResourceLinkExternalIDs() {
            if (typeof regularResourceLinkManager === 'undefined' || 
                typeof regularResourceLinkManager.getExternalIDByResourceExternalID !== 'function') {
                console.error("Global variable 'regularResourceLinkManager' or its method 'getExternalIDByResourceExternalID' is not defined.");
                return;
            }
    
            // Iterate through each work item
            for (let [workItemID, workItemRecord] of this.workItems.entries()) {
                // Iterate through each resource link in the work item
                for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
                    // Fetch the ResourceLinkExternalID
                    const resourceLinkExternalID = regularResourceLinkManager.getExternalIDByResourceExternalID(
                        resourceLinkRecord.resourceExternalId, workItemRecord.extractTaskID());
    
                    // Update the ResourceLinkRecord with the fetched ID
                    if (resourceLinkExternalID) {
                        resourceLinkRecord.resourceLinkExternalID = resourceLinkExternalID;
                    } else {
                       // console.warn(`ResourceLinkExternalID not found for ResourceExternalID: ${resourceLinkRecord.resourceExternalId}, WorkItemExternalID: ${workItemRecord.externalID}`);
                    }
                }
            }
        }
 // Save forecast effort balance method to save the model per each tasks and resource link assignment 
    saveForecastEffortBalance() {
    if (typeof regularResourceLinkManager === 'undefined') {
        console.error("Global variable 'regularResourceLinkManager' is not defined.");
        return;
    }

    // The daily query provides per-link current-month remaining forecast (from this Monday until EOM).
    // That per-link daily data is authoritative for the save. Do not redistribute or override here.

    const updates = [];

    for (let [workItemID, workItemRecord] of this.workItems.entries()) {
        for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
            const resourceLinkID = resourceLinkRecord.resourceLinkExternalID;
            // Use this-month-inclusive forecast total in days, then convert to hours for save
            const remainingForecastDays = resourceLinkRecord.getForecastUntilEOMPlusFutureInDays();
            const RemainingForecastHours = remainingForecastDays * HOURS_PER_DAY;
            // Fees calculated from this-month-inclusive months (per-month values converted to hours and rates)
            const RemainingForecastFees = resourceLinkRecord.getRemainingForecastFeesFromThisMonth();

            if (resourceLinkID && !isNaN(RemainingForecastHours) && !isNaN(RemainingForecastFees)) {
                const formattedHours = `${RemainingForecastHours}h`;
                const formattedFees = `${RemainingForecastFees.toFixed(2)}${currencyType}`;
                updates.push({
                    path: `/RegularResourceLink/${resourceLinkID}`,
                    data: {
                        C_RemainingForecastFees: formattedFees,
                        C_ForecastEffortBalance: formattedHours
                    }
                });
            } else {
                console.warn(`Skipping update for resourceLinkID: ${resourceLinkID} due to invalid data.`);
            }
        }
    }

    if (updates.length > 0) {
        const self = this;
        API.Utils.beginUpdate();
        processSequentialUpdates(updates, () => {
            API.Utils.syncChanges();
            API.Utils.endUpdate();
            setTimeout(() => enableButton(), 3000);
            alert('Forecast Effort Balance Saved! Please wait a few mintues then do the dual refresh to check the update in the Work Plan.');

            // If caller requested restore after save (zero-before-save flow), restore now
            try {
                if (self && self._postSaveRestore) {
                    if (typeof self.restoreYearMonthlyRecords === 'function') {
                        self.restoreYearMonthlyRecords();
                        console.log('Project model restored from backup after save (zero-before-save flow)');
                    }
                    self._postSaveRestore = false;
                }
            } catch (e) {
                console.warn('Error restoring project model after save', e);
            }
        });
    } else {
        alert('No updates to process!');
    }
    }
    // distribution logic intentionally removed: daily per-link data is authoritative and should be saved as-is

    // --- Backup / Zero / Restore helpers for zero-before-save flow ---
    // Create a deep backup of all yearMonthlyRecords on each ResourceLinkRecord so we can restore later
    backupYearMonthlyRecords() {
        for (let [workItemID, workItemRecord] of this.workItems.entries()) {
            for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
                try {
                    resourceLinkRecord._backupYearMonthlyRecords = JSON.parse(JSON.stringify(resourceLinkRecord.yearMonthlyRecords || []));
                } catch (e) {
                    resourceLinkRecord._backupYearMonthlyRecords = (resourceLinkRecord.yearMonthlyRecords || []).slice();
                }
            }
        }
        console.log('Project model backupYearMonthlyRecords completed');
    }

    // Zero out assignmentInDays on all yearMonthlyRecords (in-place)
    zeroYearMonthlyRecords() {
        for (let [workItemID, workItemRecord] of this.workItems.entries()) {
            for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
                if (!resourceLinkRecord.yearMonthlyRecords) continue;
                resourceLinkRecord.yearMonthlyRecords.forEach(rec => {
                    if (rec && typeof rec.assignmentInDays !== 'undefined') {
                        rec.assignmentInDays = 0;
                    }
                });
            }
        }
        console.log('Project model zeroYearMonthlyRecords applied');
    }

    // Restore yearMonthlyRecords from the deep backup created earlier
    restoreYearMonthlyRecords() {
        for (let [workItemID, workItemRecord] of this.workItems.entries()) {
            for (let [userExternalId, resourceLinkRecord] of workItemRecord.resourceLinks.entries()) {
                if (resourceLinkRecord._backupYearMonthlyRecords) {
                    try {
                        resourceLinkRecord.yearMonthlyRecords = JSON.parse(JSON.stringify(resourceLinkRecord._backupYearMonthlyRecords));
                    } catch (e) {
                        resourceLinkRecord.yearMonthlyRecords = (resourceLinkRecord._backupYearMonthlyRecords || []).slice();
                    }
                    delete resourceLinkRecord._backupYearMonthlyRecords;
                }
            }
        }
        console.log('Project model restoreYearMonthlyRecords completed');
    }

    // Public helper: backup -> zero -> save -> (restore)
    // When called, it will zero the in-memory model and then call the regular save.
    // After the save completes the model will be restored from backup so the UI/diagnostics remain unchanged.
  // Zero the stored Clarizen values using the RegularResourceLinkManager before performing the real save
    saveForecastEffortBalanceZeroed() {
        try {
            if (!regularResourceLinkManager || !Array.isArray(regularResourceLinkManager.links)) {
                console.warn('saveForecastEffortBalanceZeroed: regularResourceLinkManager not ready, running direct save');
                this.saveForecastEffortBalance();
                return;
            }

            const zeroUpdates = [];
            const zeroFees = `0.00${currencyType}`;
            const zeroHours = '0h';

            for (const link of regularResourceLinkManager.links) {
                if (link && link.externalid) {
                    zeroUpdates.push({
                        path: `/RegularResourceLink/${link.externalid}`,
                        data: {
                            C_RemainingForecastFees: zeroFees,
                            C_ForecastEffortBalance: zeroHours
                        }
                    });
                }
            }

            if (zeroUpdates.length === 0) {
                console.warn('saveForecastEffortBalanceZeroed: no links found to zero, running direct save');
                this.saveForecastEffortBalance();
                return;
            }

            // 1) Zero everything per RegularResourceLink
            API.Utils.beginUpdate();
            processSequentialUpdates(zeroUpdates, () => {
                // 2) Ensure zeroing is committed before the actual save
                API.Utils.syncChanges();
                API.Utils.endUpdate();

                // 3) Now perform the actual save (no backup/restore)
                this.saveForecastEffortBalance();
            });
        } catch (e) {
            console.warn('saveForecastEffortBalanceZeroed failed', e);
            try { API.Utils.endUpdate(); } catch (_) {}
            // Fallback: do the actual save if zeroing flow fails
            this.saveForecastEffortBalance();
        }
    }

}


class WorkItemRecord {

    constructor(externalID, workItemSysId, workItemName) {
        this.externalID = externalID; // Unique identifier
        this.workItemSysId = workItemSysId;
        this.workItemName = workItemName;
        // Map of resource link records with unique UserExternalId
        this.resourceLinks = new Map();
    }

    // Add or update a resource link record
    addOrUpdateResourceLink(userExternalId, resourceName, resourceExternalId, jobTitleExternalID, jobTitleName) {
        if (!this.resourceLinks.has(userExternalId)) {
            this.resourceLinks.set(userExternalId, new ResourceLinkRecord(resourceName, resourceExternalId, jobTitleExternalID, jobTitleName));
        }
        return this.resourceLinks.get(userExternalId);
    }

    // Get a resource link by UserExternalId
    getResourceLink(userExternalId) {
        return this.resourceLinks.get(userExternalId);
    }

    // Extract text after "/Task/" from externalID
    extractTaskID() {
        const taskPrefix = "/Task/";
        return this.externalID.startsWith(taskPrefix) ? this.externalID.slice(taskPrefix.length) : null;
    }
}

class ResourceLinkRecord {
    constructor(resourceName, resourceExternalId, jobTitleExternalID, jobTitleName) {
        this.resourceName = resourceName;
        this.resourceExternalId = resourceExternalId;
        this.jobTitleExternalID = jobTitleExternalID;
        this.jobTitleName = jobTitleName;
        this.resourceLinkExternalID = null; // ResourceLinkExternalID will start as null and will be updated after the resourcelink model is loaded
        // Array of YearMonthlyRecords
        this.yearMonthlyRecords = [];
    }

    // Add or update a year-month record
    addOrUpdateYearMonthlyRecord(year, month, assignmentInDays = 0, rate = 0, currencyExchange = 0, isCurrentMonth = false) {
        // We store monthly records in days to match the UI representation (Forecast Until EOM is in days).
        let existingRecord = this.yearMonthlyRecords.find(record => record.year === year && record.month === month);

        if (existingRecord) {
            // Accumulate assignmentInDays for existing records so daily rows sum up for the month.
            existingRecord.assignmentInDays += assignmentInDays;
            // If any incoming record marks this as current month, ensure flag is preserved.
            if (isCurrentMonth) existingRecord.isCurrentMonth = true;
        } else {
            // Add new record if it does not exist
            this.yearMonthlyRecords.push(new YearMonthlyRecord(year, month, assignmentInDays, rate, currencyExchange, isCurrentMonth));
        }
    }

    // Get all year-month records
    getYearMonthlyRecords() {
        return this.yearMonthlyRecords;
    }

    // Method to calculate the sum of assignmentInHours across all year-month records
    getTotalAssignmentInHours() {
        // Convert stored days into hours for callers that expect hours
        return this.yearMonthlyRecords.reduce((sum, record) => sum + (record.assignmentInDays || 0) * HOURS_PER_DAY, 0);
    }

    // Method to calculate the weighted sum of assignmentInHours * rate * currencyExchange across all year-month records
    getWeightedSumAssignment() {
        // Stored assignment is in days; convert to hours before applying rate (rates are per hour)
        return this.yearMonthlyRecords.reduce((sum, record) => {
            const rateValue = record.rate?.regularRate?.value || 0;
            const sourceCurrency = record.rate?.regularRate?.currency || 'AUD';
            const exchangeRate = record.currencyExchange || 1;
            const hours = (record.assignmentInDays || 0) * HOURS_PER_DAY;
            const convertedValue = convertToProjectCurrency(
                hours * rateValue,
                sourceCurrency,
                currencyType,
                exchangeRate,
                record.month,
                record.year
            );
            return sum + convertedValue;
        }, 0);
    }

    // Return total assignment in DAYS from this month (inclusive) onward
    getForecastUntilEOMPlusFutureInDays() {
        try {
            const cutoff = new Date(thisYear, thisMonth - 1, 1);
            return this.yearMonthlyRecords.reduce((sum, r) => {
                const recDate = new Date(r.year, r.month - 1, 1);
                if (recDate >= cutoff) return sum + (Number(r.assignmentInDays) || 0);
                return sum;
            }, 0);
        } catch (e) {
            console.warn('getForecastUntilEOMPlusFutureInDays failed', e);
            return 0;
        }
    }

    // Compute remaining forecast FEES for this month (inclusive) onward by converting
    // each month's per-link assignment (days -> hours) and applying that month's rate and exchange.
    // This uses the per-month values already present in the model (no redistribution/proration).
    getRemainingForecastFeesFromThisMonth() {
        try {
            const cutoff = new Date(thisYear, thisMonth - 1, 1);
            return this.yearMonthlyRecords.reduce((sum, record) => {
                const recDate = new Date(record.year, record.month - 1, 1);
                if (recDate >= cutoff) {
                    const rateValue = record.rate?.regularRate?.value || 0;
                    const sourceCurrency = record.rate?.regularRate?.currency || 'AUD';
                    const exchangeRate = record.currencyExchange || 1;
                    const hours = (record.assignmentInDays || 0) * HOURS_PER_DAY;
                    const convertedValue = convertToProjectCurrency(
                        hours * rateValue,
                        sourceCurrency,
                        currencyType,
                        exchangeRate,
                        record.month,
                        record.year
                    );
                    return sum + convertedValue;
                }
                return sum;
            }, 0);
        } catch (e) {
            console.warn('getRemainingForecastFeesFromThisMonth failed', e);
            return 0;
        }
    }
}

class YearMonthlyRecord {
    constructor(year = 0, month = 0, assignmentInDays = 0, rate = 0, currencyExchange = 0, isCurrentMonth = false) {
        this.year = year; // Number
        this.month = month; // Number
        // Store assignment as days to match UI representation; conversions to hours happen where needed
        this.assignmentInDays = assignmentInDays; // Number
        this.rate = rate; // Object { regularRate: {value, currency}, overtimeRate: {...} }
        this.currencyExchange = currencyExchange; // Number
        this.isCurrentMonth = isCurrentMonth; // Boolean
    }
}

// this function will get the results of the monthly labor resource forecast calculated across all the project dates 
// and the results of the labor resource forecast daily and will add the data to the model only for dates
// that are between this monday until the end of the project 
// to get the estimation records from this monday onwards  
function buildProjectRemainingForecastFeesModel(results, numOfMonths) {
    if (!projectRemainingForecastFeesModel) {
        projectRemainingForecastFeesModel = new ProjectRemainingForecastFeesModel();
    }

    for (let i = 0; i < results.length; i++) {
        const record = results[i];

        // Extract data from JSON record
        const workItemId = record.WorkITem.id || '';
        const workItemSysId = record.WorkITem?.SYSID || '';
        const workItemName = record.WorkITem?.Name || '';
        const input = record.User?.id || '';
        const userExternalId = input.replace("/User/", "");
        const resourceName = record.User?.Name || '';
        const resourceExternalId = userExternalId; // Assuming User ID is used as ResourceExternalId
        const jobTitleExternalID=record.User.JobTitle.externalid;
        const jobTitleName = record.User.JobTitle.Name;
        // Extract date-related information
            const date = new Date(record.Date);
            const year = date.getFullYear();
            const month = date.getMonth() + 1; // JS months are 0-based
            const isCurrentMonth = new Date().getMonth() + 1 === month && new Date().getFullYear() === year;

            // We only want daily records from thisMonday until the end of this month (lastDayOfThisMondayMonth)
            // and monthly aggregated records from firstDateOfNextMonth until the project end date (toEndDate).
            // This prevents double-counting the current month when both daily and monthly queries are present.
            let assignmentInHours = 0;
            let assignmentInDays = 0;

            try {
                // daily portion (this Monday -> end of this Monday's month)
        if (isDateBetween(record.Date, thisMonday, lastDayOfThisMondayMonth)) {
            // The incoming values (record.Work.value / record.ProjectAssignment.value) are hours.
            // Convert to days to match the rest of the model/UI which uses days.
            const rawVal = (laborBudget === "Task Assignment") ? (record.Work?.value || 0) : (record.ProjectAssignment?.value || 0);
            assignmentInHours = Number(rawVal) || 0;
            assignmentInDays = assignmentInHours / HOURS_PER_DAY;
                }

                // monthly portion (first of next month -> project end)
                else if (isDateBetween(record.Date, firstDateOfNextMonth, toEndDate)) {
                    const rawVal = (laborBudget === "Task Assignment") ? (record.Work?.value || 0) : (record.ProjectAssignment?.value || 0);
                    assignmentInHours = Number(rawVal) || 0;
                    assignmentInDays = assignmentInHours / HOURS_PER_DAY;
                } else {
                    // outside the ranges we care about for project-level save, skip this record
                    continue;
                }
            } catch (e) {
                // If any unexpected structure, skip the record
                console.warn('Skipping record due to error parsing dates/values', e, record);
                continue;
            }

        // Extract additional properties if available
        //const rate = record.ProjectAssignment?.value || 0;
        let JobTitlerates = jobTitlesRateModel.getRates(jobTitleExternalID, month, year);   
        //var currencyExchange = (currencyType === "AUD") ? 1 : 1;
        let exchangeRate=0;
        if (currencyType !== "AUD") {
            //exchangeTable.getExchangeRateForCurrencyAndMonth("USD", 12, 2021))
            exchangeRate= exchangeTable.getExchangeRateForCurrencyAndMonth(currencyType,month,year);
        } else {
            exchangeRate=1;
        }
        //add the record only if the record date (monthly or daily) is falling between this monday and the project end date
        //if(isDateBetween(record.Date,thisMonday,toEndDate)){
            // Add or update work item in the model
            const workItem = projectRemainingForecastFeesModel.addOrUpdateWorkItem(workItemId, workItemSysId, workItemName);
            // Try to capture work item state from several possible result shapes.
            try {
                let wiState = null;
                // Common shapes returned by different queries / timephase types
                if (record.WorkITem && record.WorkITem.State && record.WorkITem.State.Name) wiState = record.WorkITem.State.Name;
                else if (record.WorkItem && record.WorkItem.State && record.WorkItem.State.Name) wiState = record.WorkItem.State.Name;
                else if (record.WorkITem && typeof record.WorkITem.State === 'string') wiState = record.WorkITem.State;
                else if (record.WorkItem && typeof record.WorkItem.State === 'string') wiState = record.WorkItem.State;
                else if (record.State && record.State.Name) wiState = record.State.Name;

                if (wiState) {
                    workItem.state = wiState;
                }
            } catch (e) {
                // Non-fatal — continue without state
            }

            // Add or update resource link for the work item
        const resourceLink = workItem.addOrUpdateResourceLink(userExternalId, resourceName, resourceExternalId, jobTitleExternalID, jobTitleName);

    // Decide assignmentInDays for this record.
    // For the current month prefer the authoritative per-user forecast value from dataModel
    let finalAssignmentInDays = assignmentInDays;
    try {
        // Keep finalAssignmentInDays from the incoming daily/monthly data.
        // Do NOT overwrite current-month per-link daily values with aggregated per-user UI values here.
    } catch (e) {
        console.warn('Error resolving authoritative current-month forecast from dataModel', e);
    }

    // Add or update the year-month record for the resource link using the final assignmentInDays
    resourceLink.addOrUpdateYearMonthlyRecord(year, month, finalAssignmentInDays, JobTitlerates, exchangeRate, isCurrentMonth);
        //}       
    }

    // increment build counter (we will print sample only after rates have been loaded and applied)
    try {
        projectRemainingForecastBuildCount = (projectRemainingForecastBuildCount || 0) + 1;
    } catch (e) {
        console.warn('Error incrementing projectRemainingForecastBuildCount', e);
    }

    // Diagnostics: count how many work items have state populated vs missing (helpful when query fields vary)
    try {
        let total = 0, withState = 0, withoutState = 0;
        for (const wi of projectRemainingForecastFeesModel.workItems.values()) {
            total++;
            if (wi.state) withState++; else withoutState++;
        }
        console.log(`buildProjectRemainingForecastFeesModel: workItems=${total}, withState=${withState}, withoutState=${withoutState}`);
    } catch (e) { /* ignore diagnostics errors */ }
}

// Debug helper: print first 2 work items and their resource links + monthly records
function printProjectRemainingForecastSample() {
    if (!projectRemainingForecastFeesModel) {
        console.log('projectRemainingForecastFeesModel not initialized');
        return;
    }

    // Only print work items that explicitly have workItem.state === 'Active'
    const items = Array.from(projectRemainingForecastFeesModel.workItems.values());
    console.log("--- Project Remaining Forecast Sample (work items where workItem.state === 'Active') ---");
    items.forEach((workItem, wiIndex) => {
        try {
            // Filter strictly on the `state` property matching 'Active'
            if (workItem.state !== 'Active') return;

            console.log(`WorkItem ${wiIndex + 1}: externalID=${workItem.externalID}, SYSID=${workItem.workItemSysId}, name=${workItem.workItemName}, state=${workItem.state}`);
            const resourceLinks = Array.from(workItem.resourceLinks.values()).slice(0, 50); // safety cap
            if (resourceLinks.length === 0) {
                console.log('  (no resource links)');
            }
            resourceLinks.forEach((rl, rlIndex) => {
                console.log(`  ResourceLink ${rlIndex + 1}: resourceName=${rl.resourceName}, resourceExternalId=${rl.resourceExternalId}, jobTitleExternalID=${rl.jobTitleExternalID}, jobTitleName=${rl.jobTitleName}, resourceLinkExternalID=${rl.resourceLinkExternalID}`);
                if (!rl.yearMonthlyRecords || rl.yearMonthlyRecords.length === 0) {
                    console.log('    (no yearMonthlyRecords)');
                    return;
                }
                rl.yearMonthlyRecords.forEach((yrRec) => {
                    try {
                        const monthStr = `${yrRec.year}-${String(yrRec.month).padStart(2, '0')}`;
                        // We store assignment as days in the model. Show both days and converted hours for clarity.
                        const assignmentDays = typeof yrRec.assignmentInDays === 'number' ? yrRec.assignmentInDays : Number(yrRec.assignmentInDays) || 0;
                        const assignmentHours = assignmentDays * HOURS_PER_DAY;

                        // Normalize rate display: support several shapes that may appear in yrRec.rate
                        let rateValue = null;
                        let rateCurrency = '';
                        let rateJson = null;
                        if (yrRec.rate) {
                            if (yrRec.rate.regularRate && typeof yrRec.rate.regularRate.value !== 'undefined') {
                                rateValue = yrRec.rate.regularRate.value;
                                rateCurrency = yrRec.rate.regularRate.currency || '';
                            } else if (yrRec.rate.regular && typeof yrRec.rate.regular.value !== 'undefined') {
                                rateValue = yrRec.rate.regular.value;
                                rateCurrency = yrRec.rate.regular.currency || '';
                            } else if (typeof yrRec.rate === 'object') {
                                try { rateJson = JSON.stringify(yrRec.rate); } catch (e) { rateJson = String(yrRec.rate); }
                            } else {
                                rateValue = yrRec.rate;
                            }
                        }

                        const exch = (yrRec.currencyExchange !== undefined && yrRec.currencyExchange !== null) ? yrRec.currencyExchange : null;

                        const rateDisplay = rateValue !== null && rateValue !== undefined ? `${rateValue}` : (rateJson || '0');
                        const currencySuffix = rateCurrency ? ` ${rateCurrency}` : '';

                        // Calculate converted fees for this month: hours * rate * exchange -> converted to project currency
                        let feesConverted = 0;
                        try {
                            const srcCurrency = rateCurrency || '';
                            const hrs = assignmentHours || 0;
                            const rateVal = Number(rateValue) || 0;
                            feesConverted = convertToProjectCurrency(hrs * rateVal, srcCurrency, currencyType, exch, yrRec.month, yrRec.year);
                        } catch (e) {
                            feesConverted = 0;
                        }

                        console.log(`    ${monthStr}: assignmentDays=${assignmentDays}, assignmentHours=${assignmentHours}, isCurrentMonth=${!!yrRec.isCurrentMonth}, rate=${rateDisplay}${currencySuffix}, currencyExchange=${exch}, fees=${feesConverted.toFixed(2)}${currencyType}`);
                        if (rateJson) console.log(`      rateObject: ${rateJson}`);
                    } catch (e) {
                        console.warn('    Error printing yearMonthlyRecord', e, yrRec);
                    }
                });
            });
        } catch (e) {
            console.warn('Error printing workItem', e, workItem);
        }
    });
    console.log('--- End of sample ---');
}


/*=========================================== Project Forecast Model End ==== */

$(function () {
    var yearsRow, tdCell, roleCell;

    exchangeTable = new CurrencyExchange();//will hoold the exchange rates
    
    jobTitlesRateModel = new RateModel();//will hold the rates per job title based on the project rate card

    regularResourceLinkManager = new RegularResourceLinkManager();

    projectRemainingForecastFeesModel = new ProjectRemainingForecastFeesModel();
    
    yearsRow = $("#years-row");

    try {

        selectedForecastType= getSelectedForecastType(); 

        console.log("Current Project: " + data.currentProject.SYSID);		
        var forecastType = document.getElementById('forecastType');
        forecastType.addEventListener('change', function(event) {
            forecastTypeSwitch(event);
        });			
        
        var saveButton = document.getElementById('saveForecastEffortBalance');
        saveButton.addEventListener('click', function (event) {
            saveForecastModel(event);
        });

        var downloadExcelButton = document.getElementById("downloadExcel");
        downloadExcelButton.addEventListener('click', function (event) {
            downloadExcel(event);
        });

        
        
        const headers = FORECST_TOTLAS_HEADERS[selectedForecastType] || ["Unknown", "Unknown","Unknown"];

        //now add back the 3 headers removed Work(D), Actual Regular Effort (D),Forecast Effort Balance (D)
        tdCell = $("<td rowspan='" + 4 + "'>"+headers[0]+"</td>");
        tdCell.addClass("year-seprator");
        yearsRow.append(tdCell);
        tdCell = $("<td rowspan='" + 4 + "'>"+headers[1]+"</td>");
        yearsRow.append(tdCell);
        tdCell = $("<td rowspan='" + 4 + "'>"+headers[2]+"</td>");
        yearsRow.append(tdCell);

        //add the years and months
        numOfMonths = iterateOnMonthsRange(true);//first call on init, need to add the TD's as pre append
        
        
//        if (monthNameList[datePickerStart.getMonth()] == "Jan") {
   //         roleCell.addClass("year-right-seprator");
   //     } else {
   //         roleCell.removeClass("year-right-seprator");
   //     }

       
        //load data, start with currencies 
        loadCurrncies(numOfMonths);
    } catch (err) {
        console.log(err);
    }

});

// Function to be called when the button is clicked
// Function to process API updates sequentially
function processSequentialUpdates(updates, finalCallback) {
    function updateNext(index) {
        if (index >= updates.length) {
            // All updates are processed, call finalCallback
            finalCallback();
            return;
        }

        const update = updates[index];
        API.Objects.update(update.path, update.data, function () {
            // Continue to the next update
            updateNext(index + 1);
        });
    }

    // Start processing from the first update
    updateNext(0);
}

// Function to enable the button
function enableButton() {
    const saveButton = document.getElementById('saveForecastEffortBalance');
    const downloadExcelBtn = document.getElementById('downloadExcel');    
    downloadExcelBtn.disabled = false;
    downloadExcelBtn.classList.add('btn-enabled');
        console.log('enableButton called', { laborBudget: laborBudget });
    if (laborBudget === "Task Assignment") { 
      saveButton.disabled = false;  
      saveButton.classList.add('btn-enabled');
            console.log('enableButton: save button enabled');
    }
  
}

// Function to disable the button
function disableButton() {
    const saveButton = document.getElementById('saveForecastEffortBalance');
    const downloadExcelBtn = document.getElementById('downloadExcel');    
    saveButton.disabled = true;
    downloadExcelBtn.disabled = true;
    saveButton.classList.remove('btn-enabled');
    downloadExcelBtn.classList.remove('btn-enabled');
    console.log('disableButton called: save/download disabled');
}

// Deterministic readiness checker: enable the save button only when required models are loaded.
function ensureEnableButtonReady() {
    try {
        // Determine required model readiness based on the selected forecast type
        const needEffort = (selectedForecastType === undefined) || (selectedForecastType === FORECAST_TYPES.EFFORTS);
        const needFinance = (selectedForecastType === FORECAST_TYPES.FINANCIALS);

        const effortReady = !!effortModelLoaded || !needEffort;
        const financeReady = !!financeModelLoaded || !needFinance;
        const projectReady = (WorkItemtype !== 'Project') || !!projectRemainingForecastFeesModel;

        const ready = effortReady && financeReady && projectReady;
        console.log('ensureEnableButtonReady checking', { selectedForecastType, needEffort, needFinance, effortModelLoaded: !!effortModelLoaded, financeModelLoaded: !!financeModelLoaded, projectModelPresent: !!projectRemainingForecastFeesModel, WorkItemtype: WorkItemtype, ready: ready });

        // track retry attempts to avoid infinite looping
        ensureEnableButtonReady._attempts = (ensureEnableButtonReady._attempts || 0) + 1;

        if (ready) {
            console.log('ensureEnableButtonReady: conditions met, calling enableButton');
            enableButton();
            ensureEnableButtonReady._attempts = 0; // reset counter
        } else {
            if (ensureEnableButtonReady._attempts > 120) { // ~60s with 500ms backoff
                console.warn('ensureEnableButtonReady: giving up after too many attempts', { attempts: ensureEnableButtonReady._attempts });
                return;
            }
            // Retry shortly; using a small backoff to avoid tight loop
            console.log('ensureEnableButtonReady: not ready, retrying in 500ms');
            setTimeout(ensureEnableButtonReady, 500);
        }
    } catch (e) {
        console.warn('ensureEnableButtonReady encountered error, retrying in 1000ms', e);
        setTimeout(ensureEnableButtonReady, 1000);
    }
}
//main save function will call the task level save or the project level model
function saveForecastModel(event){
    if(WorkItemtype === "Project"){
        if (projectRemainingForecastFeesModel) {
            disableButton();
            // Use the zero-before-save wrapper so the model can be zeroed (and restored) for a controlled save
            if (typeof projectRemainingForecastFeesModel.saveForecastEffortBalanceZeroed === 'function') {
                projectRemainingForecastFeesModel.saveForecastEffortBalanceZeroed();
            } else {
                projectRemainingForecastFeesModel.saveForecastEffortBalance();
            }
        }else {
             console.log("Cannot save - projectRemainingForecastFeesModel is not loaded or empty");
        }
      }else{
        disableButton();
        saveForecastEffortBalanceTaskLevel(event);      
      }
}

// Main function to save Forecast Effort Balance in case the save was called from the task level
//in case the save was selected from the project another function will be called 
function saveForecastEffortBalanceTaskLevel(event) {
    var RemainingForecastHours, RemainingForecastFees;
    var updates = []; // Array to store all updates

    if (dataModel.size > 0) {
        API.Utils.beginUpdate();

        for (var [key, value] of dataModel) {
            let userKey = getUserIdFromPath(value.userKey);
            //get resource link ID by the resource and the Work Item 
            let resourceLinkID = regularResourceLinkManager.getExternalIDByResourceExternalID(userKey,workItemExternalID);

            if (resourceLinkID) {
                if (laborBudget === "Task Assignment") {
                    RemainingForecastHours = Number(value.getForecastEffortBalanceTaskAssignment());
                    RemainingForecastFees  = Number(value.getRemainingForecastFeesTaskAssignment());	
                } else {
                    RemainingForecastHours = Number(value.getForecastEffortBalanceProjectAssignment());
                    RemainingForecastFees  = Number(value.getRemainingForecastFeesProjectAssignment());	
                }

                if (!isNaN(RemainingForecastHours) && !isNaN(RemainingForecastFees) ) {
                    // Convert the value into the required string format
                    let formattedValue = `${RemainingForecastHours * HOURS_PER_DAY}h`;
                    let formaTtedRemainingForecastFees = RemainingForecastFees +currencyType;

                    // Push the update to the updates array of Forecast Effort Balance (hours)
                    //updates.push({
                      //  path: `/RegularResourceLink/${resourceLinkID}`,
                       // data: { C_ForecastEffortBalance: formattedValue }
                    //});
                    //update Remaining Forecast Fees with currency values 
                    updates.push({
                        path: `/RegularResourceLink/${resourceLinkID}`,
                        data: { C_RemainingForecastFees: formaTtedRemainingForecastFees,C_ForecastEffortBalance:formattedValue }
                    });
                }
            }
        }

        // Process updates sequentially
        processSequentialUpdates(updates, function () {
            API.Utils.syncChanges();
            API.Utils.endUpdate(); // End update transaction once all updates are done
            API.Utils.endLoading();
            console.log('Loading complete: using ensureEnableButtonReady instead of timed enable');
            ensureEnableButtonReady();
            alert('Forecast Effort Balance Saved! Please wait a few minutes then do the dual refresh to check the update in the Work Plan.');
        });
    } else {
        alert('No data to process!');
    }
}



function getUserIdFromPath(path) {
    // Check if the path contains '/User/'
    var prefix = "/User/";
    if (path.includes(prefix)) {
        // Extract and return the value after '/User/'
        return path.split(prefix)[1];
    } else {
        return null; // Return null if '/User/' is not found
    }
}

//will get the selected forecast types 
function getSelectedForecastType() {
    return $('#forecastType').val();
}

/*
Based on the selected forecast type update the total headers 
Add or remove a cell in the switch 
*/
function switchTotalHeaders() {
    const yearsRow = $("#years-row"); // The row containing the cells
    const headers = FORECST_TOTLAS_HEADERS[selectedForecastType] || ["Unknown", "Unknown", "Unknown", "Unknown"];

    // If Financials is selected, iterate through all headers (0 to 3)
    if (selectedForecastType === FORECAST_TYPES.FINANCIALS) {
        updateCellInYearsRow(0,headers[0]);
        updateCellInYearsRow(1,headers[1]);
        updateCellInYearsRow(2,headers[2]);
        //add a new summary column
        addCellToYearsRow(2,headers[3]);        
    } else {
        removeCellFromYearsRow(3);
        updateCellInYearsRow(0,headers[0]);
        updateCellInYearsRow(1,headers[1]);
        updateCellInYearsRow(2,headers[2]);
    }
}

function updateCellInYearsRow(columnNumber, newContent) {
    const yearsRow = $("#years-row"); // The row containing the cells

    // Find the target cell by column number
    const targetCell = yearsRow.children().eq(columnNumber);

    if (targetCell.length) {
        // Update the content of the target cell
        targetCell.html(newContent);
    } else {
        console.warn(`No cell found at column ${columnNumber} to update.`);
    }
}



//will load currencies table in case the currency type is not AUD
function loadCurrncies(numOfMonths){
    if (currencyType !== "AUD") {
        var resultQry = new Array();
    	
        API.Utils.beginLoading();
            
        const query = "Select BaseCurrency.name,QuoteCurrency.name,EffectiveFrom,ExchangeRate from CurrencyExchangeRate limit 5000 offset ";
        
        //load data with pagings 
        queryMore(0, resultQry, parseCurrencies, query,numOfMonths);
        
    } else{
        //load data regulary because its AUD
       executeQuery(numOfMonths);
    }  
}

//will parse the currencies into the model and call the next function
function parseCurrencies(result, numOfMonths) {
    for (let i = 0; i < result.length; i++) {
        const exchangeRecord = result[i];        
        const exRecord = new CurrencyExchangeRecord(
            exchangeRecord.id,
            exchangeRecord.BaseCurrency.name,
            exchangeRecord.QuoteCurrency.name,
            exchangeRecord.EffectiveFrom,
            exchangeRecord.ExchangeRate
        );
        exchangeTable.addRecord(exRecord);
    }
    executeQuery(numOfMonths);
}

function executeQuery(nomOfMonths){
	var resultQry = new Array();
    	
	API.Utils.beginLoading();
		
    const query = QueryBuilder(WorkItemtype === "Project" ? 1 : 3);
	
	//load data with pagings 
    queryMore(0, resultQry, buildUserDataModel, query,nomOfMonths);
}

//main ufnction to call the financial model load
function executeFinancialQuery(nomOfMonths){
    var resultQry = new Array();
   
    //clear table first
     removeTBodyRows();
	API.Utils.beginLoading();
		
    const query = QueryBuilder(WorkItemtype === "Project" ? 5 : 7);
	
	//load data with pagings 
    queryMore(0, resultQry, buidFinancialDataModel, query,nomOfMonths);
}

/*
 will be called for buiding the data model of financials
 */
function buidFinancialDataModel(result, numOfMonths){
    for (let i = 0; i < result.length; i++) {
        const financeRecord = result[i];
        let period, periodYear, periodMonth,userDisplayName,userDiscipline,userJobTitle,userJobTitleEId,userId,PlannedBudget,ActualCost,C_MarkupRevenue,exchangeRate;
        
        // Determine the user
        if (financeRecord.RelatedLink.LaborResource) {
            userId = financeRecord.RelatedLink.LaborResource.id;
            userDisplayName = financeRecord.RelatedLink.LaborResource.DisplayName;
            userDiscipline  = financeRecord.RelatedLink.LaborResource?.C_Discipline?.name ?? "";
           

        } else {
            userId = "No User";
        } 
        // Determine the user job title 
        if (financeRecord.RelatedLink.LaborResource.JobTitle) {
            userJobTitle = financeRecord.RelatedLink.LaborResource.JobTitle.Name;
            userJobTitleEId = financeRecord.RelatedLink.LaborResource.JobTitle.externalid;
        } else {
            userJobTitle = "No Job Title";
        }
         // Try-catch blocks to safely extract values
         try { //
            //PlannedBudget = Number(financeRecord.PlannedBudget?.value)|| 0; //orignallly we were taking the budgted cost and then we have learned this is worng and we need to get the planned revenue
            PlannedBudget = Number(financeRecord.PlannedRevenue?.value)|| 0;
        } catch (err) { PlannedBudget = 0; }  
        
          
        // Calculate the date, year, and month
        period = new Date(financeRecord.Date);
        periodYear = getDateYear(period);
        periodMonth = getDateMonth(period);
        
        //get currency exchange
        if (currencyType !== "AUD") {
            //exchangeTable.getExchangeRateForCurrencyAndMonth("USD", 12, 2021))
            exchangeRate= exchangeTable.getExchangeRateForCurrencyAndMonth(currencyType,periodMonth,periodYear);
        } else {
            exchangeRate=1;
        }
        // Check if the user record already exists in the dataModel
        let userRecord = dataModel.get(userId);
        
        if (!userRecord) {
            // Create a new UserRecord if it doesn't exist
            userRecord = new UserRecord(userId,userDisplayName,null,userJobTitle,userJobTitleEId,userDiscipline);
            dataModel.set(userId, userRecord);
        }
        //now add/ update the record with the financials addOrUpdateMonthlyRecordForFinancials(year, month, budget = 0, actualBooked = 0)
        userRecord.addOrUpdateMonthlyRecordForFinancials(periodYear,periodMonth,PlannedBudget,0,exchangeRate);    
    }
    
    //now call the actual booked values
    executeActualBookedQuery(numOfMonths);
}

//Load Actual Booked data
function executeActualBookedQuery(nomOfMonths){
    var resultQry = new Array();
   
    const query = QueryBuilder(WorkItemtype === "Project" ? 6 : 8);
	
	//load data with pagings 
    queryMore(0, resultQry, addActualBookedToDataModel, query,nomOfMonths);
}


//add the actual booked from timesheets to the data model 
function addActualBookedToDataModel(result, numOfMonths){
    for (let i = 0; i < result.length; i++) {
        const timeSheetRecord = result[i];
        let period, periodYear, periodMonth,userDisplayName,userDiscipline,userId,C_D365PriceofItem,userJobTitle,userJobTitleEId;
        
        // Determine the user
        if (timeSheetRecord.ReportedBy) {
            userId = timeSheetRecord.ReportedBy.id;
            userDisplayName = timeSheetRecord.ReportedBy.DisplayName;
            userDiscipline  = timeSheetRecord.ReportedBy?.C_Discipline?.name||"";
        } else {
            userId = "No User";
        } 
        if (timeSheetRecord.ReportedBy.JobTitle) {
            userJobTitle = timeSheetRecord.ReportedBy.JobTitle.Name;
            userJobTitleEId = timeSheetRecord.ReportedBy.JobTitle.externalid;
        } else {
            userJobTitle = "No Job Title";
        } 
         // Try-catch blocks to safely extract values
         try { 
            C_D365PriceofItem = Number(timeSheetRecord.C_D365PriceofItem)|| 0;
        } catch (err) { C_D365PriceofItem = 0; }  
        
          
        // Calculate the date, year, and month
        period = new Date(timeSheetRecord.ReportedDate);
        periodYear = getDateYear(period);
        periodMonth = getDateMonth(period);
        
        // Check if the user record already exists in the dataModel
        let userRecord = dataModel.get(userId);
        
        if (!userRecord) {
            // Create a new UserRecord if it doesn't exist
            userRecord = new UserRecord(userId,userDisplayName,null,userJobTitle,userJobTitleEId,userDiscipline);
            dataModel.set(userId, userRecord);
        }
        //now add/ update the record with the financials addOrUpdateMonthlyRecordForFinancials(year, month, budget = 0, actualBooked = 0)
        userRecord.addOrUpdateMonthlyRecordForFinancials(periodYear,periodMonth,0,C_D365PriceofItem,0);    
    }
    financeModelLoaded = true;//a flag to mark that the finance model was loaded 
    //now draw the model
    drawFinancialData(numOfMonths);
}

function buildUserDataModel(result, numOfMonths){
    //build the data model	
   buildDataModel(result,numOfMonths);

   //if project is loaded add this month data to the ProjectRemainingForecastFeesModel 
   if(WorkItemtype === "Project"){
     buildProjectRemainingForecastFeesModel(result, numOfMonths);
   }  
   //call the forecast model
   executeForecastQuery(numOfMonths);
}


//Will be used for adding this month forecast data into the model
function executeForecastQuery(nomOfMonths){
    var resultQry = new Array();
    	
	const query = QueryBuilder(WorkItemtype === "Project" ? 2 : 4);
	
	//load data with pagings 
    queryMore(0, resultQry, buildThisMonthForecastDataModel, query,nomOfMonths);
}

/* willl be used for switching the selection between efforts and dollars
 */
function forecastTypeSwitch(){
    selectedForecastType= getSelectedForecastType(); 
    console.log(selectedForecastType);
    //first switch the headers values
    switchDataRowCells($("#data-header-row"),selectedForecastType);
    updatePanelHeader(selectedForecastType);
    switchTotalHeaders() ;//replce the totals headers     
    if (selectedForecastType === FORECAST_TYPES.EFFORTS){
        if(!effortModelLoaded){//model not loaded 
          executeQuery(numOfMonths);
        } else {
            drawData(null, numOfMonths);
        }
    }  else if (selectedForecastType === FORECAST_TYPES.FINANCIALS) {
        if(!financeModelLoaded){
            executeFinancialQuery(numOfMonths);//now execute the query and draw the data 
        } else{
            drawFinancialData(numOfMonths);
        }
        
    }     
}


//switch the header 
function updatePanelHeader(selectedForecastType) {
    var panelHeader = $("#panel-header");

    if (panelHeader.length) {
        // Switch the text based on the selected forecast type using the FORECAST_HEADERS object
         if (selectedForecastType === FORECAST_TYPES.EFFORTS) { 
            panelHeader.text(FORECAST_HEADERS.EFFORTS);
        } else if (selectedForecastType === FORECAST_TYPES.FINANCIALS) {
            panelHeader.text(FORECAST_HEADERS.FINANCIALS);
        } else {
            panelHeader.text("Unknown Forecast Type"); // Default text for unrecognized types
        }
    }
}


function removeCellFromYearsRow(columnNumber) {
    const yearsRow = $("#years-row"); // The row containing the cells

    // Select the cell at the specified column number
    const cellToRemove = yearsRow.children().eq(columnNumber);

    if (cellToRemove.length) {
        // Remove the cell if it exists
        cellToRemove.remove();
    } else {
        console.warn(`No cell found at column ${columnNumber} to remove.`);
    }
}

function addCellToYearsRow(columnNumber, cellContent) {
    const yearsRow = $("#years-row"); // The row containing the cells

    // Create the new cell with the specified content
    const newCell = $("<td rowspan='" + 4 + "'>").html(cellContent);

    // Find the target column and insert the new cell after it
    const targetCell = yearsRow.children().eq(columnNumber);

    if (targetCell.length) {
        // Insert the new cell after the target column
        targetCell.after(newCell);
    } else {
        console.warn(`No cell found at column ${columnNumber} to add a new cell after.`);
    }
}




//retunring formatted date function
function yyyymmdd(dateIn) {
    var monZ, dayZ;

    var yyyy = dateIn.getFullYear();
    var mm = dateIn.getMonth() + 1; // getMonth() is zero-based
    var dd = dateIn.getDate();
    //return String(10000*yyyy + 100*mm + dd); // Leading zeros for mm and dd

    if (mm > 9) {
        monZ = mm;

    } else {
        monZ = "0" + mm;
    }

    if (dd > 9) {
        dayZ = dd;

    } else {
        dayZ = "0" + dd;
    }

    return dayZ + "/" + monZ + "/" + yyyy;
}

function queryMore(from, allResults, callback, qry, numOfMonths) {
    API.Objects.query(qry + " " + from, function (results, nextQuery) {
        if (results.length > 0)
            allResults = allResults.concat(results);
        if (nextQuery && nextQuery.q.paging.hasMore) {
            queryMore(nextQuery.q.paging.from, allResults, callback, qry, numOfMonths);
        }
        else
            callback(allResults, numOfMonths);

    }, {});
}

//will get a date and will check if its current month
function isCurrentMonth(dateToCheck) {
    var today = new Date();
    var cur_month = today.getMonth();
    var cur_year = today.getFullYear();
    if (cur_year == dateToCheck.getFullYear() && cur_month == dateToCheck.getMonth()) {
        return true;
    } else {
        return false;
    }
}


//formatter for money values
Number.prototype.formatMoney = function (decPlaces, thouSeparator, decSeparator) {
    var n = this,
        decPlaces = isNaN(decPlaces = Math.abs(decPlaces)) ? 2 : decPlaces,
        decSeparator = decSeparator == undefined ? "." : decSeparator,
        thouSeparator = thouSeparator == undefined ? "," : thouSeparator,
        sign = n < 0 ? "-" : "",
        i = parseInt(n = Math.abs(+n || 0).toFixed(decPlaces)) + "",
        j = (j = i.length) > 3 ? j % 3 : 0;
    return sign + (j ? i.substr(0, j) + thouSeparator : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + thouSeparator) + (decPlaces ? decSeparator + Math.abs(n - i).toFixed(decPlaces).slice(2) : "");
};




//will iterate on the date ranges of min and max of dates to build the table of years and months at the top/ header
function iterateOnMonthsRange(isInit) {
    var dataRow, monthsRow, yearsRow, tdCell, stringDate, stringAttr;

    //from start date 
    var date = new Date(fromStartDate);

    //end date     
    var endDate = new Date(toEndDate);

    monthsRow = $("#months-row");
    yearsRow = $("#years-row");
    dataRow = $("#data-header-row");

    j = 0;
    k = 1;//will hold the month count
    //now iterate on months and add the months columns together with the data row and the years
    while (date <= endDate) {
        stringAttr = (date.getMonth() + 1) + "/" + (date.getFullYear() - 2000);
        stringDate = monthNameList[date.getMonth()];

        //add the year in case we at Dec or in case we at the last month
        if (date.getMonth() == 11 || (date.getMonth() == endDate.getMonth() && date.getFullYear() == endDate.getFullYear())) {
            tdCell = $("<td colspan='" + k * NUM_OF_DATA_COLUMNS + "' align='center'>" + date.getFullYear() + "</td>").addClass("year-seprator");
            if (isInit) {
                yearsRow.append(tdCell); // Use append instead of prepend
            } else {
                yearsRow.append(tdCell);
            }
            k = 0;
        }


        tdCell = $("<td colspan='2'>" + stringDate + "</td>").attr("dated", stringAttr);

        //add year sperator on each new year
        if (monthNameList[date.getMonth()] == "Jan") {
            tdCell.addClass("year-seprator");
        }

        //change backgroupd color if falling this month
        if (isCurrentMonth(date)) {
            tdCell.css('background', '#eb94c2');
            tdCell.attr('title', thisMonday);
        }

        monthsRow.append(tdCell);

        //now add the data cell
        if (selectedForecastType === FORECAST_TYPES.EFFORTS) {
            tdCell = $("<td>For.</td>")
        } else if (selectedForecastType === FORECAST_TYPES.FINANCIALS) {
            tdCell = $("<td>Budget</td>")
        }    
        

        if (monthNameList[date.getMonth()] == "Jan") {
            tdCell.addClass("year-seprator");
        }
        dataRow.append(tdCell);

        if (selectedForecastType === FORECAST_TYPES.EFFORTS) {
            tdCell = $("<td>Act.</td>")
        } else if (selectedForecastType === FORECAST_TYPES.FINANCIALS) {
            tdCell = $("<td>Act. Booked</td>")
        }         
        dataRow.append(tdCell);

        date.setMonth(date.getMonth() + 1);
        j += 1;
        k += 1;
    }
    //console.log("Total Months: " + j);
    return j;
    //return resultList;
}


//will switch the pairs of the datatimephase headers
function switchDataRowCells(dataRow, selectedForecastType) {
    // Define text pairs for the cells
    const CELL_VALUE_MAP = {
        [FORECAST_TYPES.EFFORTS]: ["For.", "Act."],
        [FORECAST_TYPES.FINANCIALS]: ["Budget", "Act. Booked"]
    };

    // Get the appropriate pair for the selected forecast type
    const pair = CELL_VALUE_MAP[selectedForecastType] || ["Unknown", "Unknown"];

    // Iterate through existing cells in pairs
    dataRow.find("td").each(function (index, cell) {
        if (index % 2 === 0) {
            // First cell in the pair
            $(cell).text(pair[0]);
        } else {
            // Second cell in the pair
            $(cell).text(pair[1]);
        }
    });
}


function QueryBuilder(caseNumber) {
    var qrySql = "";

    const pagingSuffix = " limit 5000 offset ";
    switch (caseNumber) {
        case 1://assignment from project level
            return "Select WorkITem,WorkITem.State.Name,WorkITem.EntityType,EntityType,WorkITem.SYSID,WorkITem.Project.SYSID,WorkITem.Name,WorkITem.Project.Name,User.C_Discipline.name,User.DisplayName,Date,User.Name,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseMonthly where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and (Work>'0h' or ActualApproved>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and (Project in(Select SYSID from Project where ExternalID='"+workItemExternalID+"'))" +pagingSuffix;
        case 2://daily forcast from this Monday until end of month from project level 
            return "Select WorkITem,WorkITem.EntityType,WorkITem.State.Name,EntityType,WorkITem.SYSID,WorkITem.Name,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.C_Discipline.name,User.Name,User.DisplayName,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseDaily where (Date>='"+thisMonday+"' and Date<='"+lastDayOfThisMondayMonth+"') and (Work>'0h' or ActualApproved>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and (Project in(Select SYSID from Project where ExternalID='"+workItemExternalID+"'))" +pagingSuffix ;       
        case 3://assignment from task level
            return "Select WorkITem.Name,WorkITem.EntityType,WorkItem.SysID,WorkITem.State.Name,WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.C_Discipline.name,User.Name,User.DisplayName,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseMonthly where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and (Work>'0h' or ActualApproved>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and ( WorkItem ='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"' or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')) or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')))))"+pagingSuffix;
        case 4: //daily forcast from this Monday until end of month from task level 
            return "Select WorkITem.Name,WorkITem.EntityType,WorkITem.State.Name,WorkItem.SysID,WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.C_Discipline.name,User.Name,User.DisplayName,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseDaily where (Date>='"+thisMonday+"' and Date<='"+lastDayOfThisMondayMonth+"') and (Work>'0h' or ActualApproved>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and ( WorkItem ='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"' or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')) or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')))))" +pagingSuffix;  
        case 5://get financials for project level aggregated
            return "Select EntityType,RelatedLink.WorkItem.Project.SYSID,RelatedLink.WorkITem.State.Name,RelatedLink.WorkItem.Project.Name,RelatedLink.LaborResource.DisplayName,RelatedLink.LaborResource.C_Discipline.name,RelatedLink.LaborResource.Name,RelatedLink.LaborResource.JobTitle.Name,RelatedLink.LaborResource.JobTitle.externalid,RelatedLink.LaborResource.Name,Date,RelatedLink.DefaultCurrency,RelatedLink.CurrencyExchangeDate,PlannedBudget,PlannedRevenue,ActualCost,C_MarkupRevenue,Aggregated,ActualRevenue,RelatedLink from ResourceTimePhase where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and RelatedLink in(select ExternalID from ResourceLinkFinancial where WorkItem ='/Project/"+workItemExternalID+"' and EntityType='LaborResourceLinkAggregated')" +pagingSuffix;  
        case 6://get project level actual booked values
            return "Select ReportedBy.DisplayName,ReportedBy.C_Discipline.name,ReportedBy.Name,ReportedBy.JobTitle.Name,ReportedBy.JobTitle.externalid,ReportedDate,C_D365PriceofItem,C_InvoiceStatus from Timesheet where ReportedDate>='"+fromStartDate+"' and ReportedDate<='"+toEndDate+"' and C_InvoiceStatus not in('Adjusted','Nonchargeable') and Project='/Project/"+workItemExternalID+"'"+pagingSuffix;
        case 7://get financials for Task level
            return "Select EntityType,RelatedLink.WorkItem.Project.SYSID,RelatedLink.WorkITem.State.Name,RelatedLink.WorkItem.Project.Name,RelatedLink.LaborResource.DisplayName,RelatedLink.LaborResource.C_Discipline.name,RelatedLink.LaborResource.Name,RelatedLink.LaborResource.JobTitle.Name,RelatedLink.LaborResource.Name,Date,RelatedLink.DefaultCurrency,RelatedLink.CurrencyExchangeDate,PlannedBudget,PlannedRevenue,ActualCost,C_MarkupRevenue,Aggregated,ActualRevenue,RelatedLink from ResourceTimePhase where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and RelatedLink in(Select ExternalID from ResourceLinkFinancial where WorkItem='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"'))" +pagingSuffix;  
        case 8://get Task level actual booed values
            return "Select ReportedBy.DisplayName,ReportedBy.C_Discipline.name,ReportedBy.Name,ReportedBy.JobTitle.Name,ReportedDate,C_D365PriceofItem,C_InvoiceStatus from Timesheet where ReportedDate>='"+fromStartDate+"' and ReportedDate<='"+toEndDate+"' and C_InvoiceStatus not in('Adjusted','Nonchargeable') and Project='/Project/"+projExternalID+"' and WorkItem='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')"+pagingSuffix;  
        case 9://get labor timephase data of project work items from the first date of next month until the proejct end date 
            return "Select WorkITem,WorkITem.EntityType,WorkITem.Name,WorkITem.State.Name,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.Name,User.C_Discipline.name,User.DisplayName,User.JobTitle.Name,ProjectAssignment,Work,ActualApproved,ActualPending,WorkItem.ChildrenCount from RLTimePhaseMonthly where (Date>='"+firstDateOfNextMonth+"' and Date<='"+toEndDate+"') and (Work>'0h' or ActualApproved>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and (Project in(Select SYSID from Project where ExternalID='"+workItemExternalID+"'))"+pagingSuffix;
        default:
            return ""; // Default case to avoid errors
    }
}


function queryMore(from, allResults, callback, qry,numOfMonths)
{
    API.Objects.query(qry + " " + from, function(results, nextQuery)
    {
        if (results.length > 0)
            allResults = allResults.concat(results);
        if (nextQuery && nextQuery.q.paging.hasMore)
        {
            queryMore(nextQuery.q.paging.from, allResults, callback, qry,numOfMonths);
        }
        else
            callback(allResults,numOfMonths);

    }, {});
}


//will drae the effort driven model
function drawData(result, numOfMonths) {
    var forecstUntillEOM;

    // Clear table first
    removeTBodyRows();

    // Sort dataModel by userDiscipline and then by userDisplayName
    const sortedData = Array.from(dataModel.values()).sort((a, b) => {
        const disciplineCompare = a.userDiscipline.localeCompare(b.userDiscipline);
        if (disciplineCompare !== 0) return disciplineCompare;
        return a.userDisplayName.localeCompare(b.userDisplayName);
    });

    // Show or hide the table based on the data
    if (dataModel.size > 0) {
        $("#data-table").show();
    } else {
        $("#data-table").hide();
    }

    tbodyTbl = $("#data-table tbody");

    // Adjust start date to beginning of the month
    var date = new Date(fromStartDate);

    // Iterate through the sorted dataModel
    for (const value of sortedData) {
        const row = $('<tr>');

        // Add discipline
        row.append($("<td>").addClass("roleCell").text(value.userDiscipline));

        // Add user name
        row.append($("<td>").addClass("roleCell").attr("title", value.userJobTitle).text(value.userDisplayName));

        let jobTitleExternalID = value.userJobTitleExternalID;

        // Work (D)
        let recKey = laborBudget === "Task Assignment" ? "taskAssignment" : "projectAssignment";
        let dataToSet = Number(value.calculateTotal(recKey)).toFixed(2);
        row.append($("<td>").css('background', '#ffffe6').attr("periodKey", recKey).attr("cellVal", dataToSet).text(Number(dataToSet).formatMoney(2, ',', '.')));

        // Actual Regular Effort (D)
        recKey = "actualApproved";
        dataToSet = Number(value.calculateTotal(recKey)).toFixed(2);
        row.append($("<td>").css('background', '#ffffe6').attr("periodKey", recKey).attr("cellVal", dataToSet).text(Number(dataToSet).formatMoney(2, ',', '.')));

        // Forecast Effort Balance (D)
        recKey = "Forecast_Effort_Balance";
        dataToSet = laborBudget === "Task Assignment" 
            ? Number(value.getForecastEffortBalanceTaskAssignment()).toFixed(3) 
            : Number(value.getForecastEffortBalanceProjectAssignment()).toFixed(3);
        row.append($("<td>").css('background', '#ffffe6').attr("periodKey", recKey).attr("cellVal", dataToSet).text(Number(dataToSet).formatMoney(2, ',', '.')));

        // Render monthly data
        const dateCopy = new Date(fromStartDate);
        for (let j = 0; j < (numOfMonths * NUM_OF_DATA_COLUMNS); j++) {
            const year = dateCopy.getFullYear();
            const month = dateCopy.getMonth() + 1;
            recKey = `${year}-${month}`;
            const collType = j % 2 === 0 ? "FOR" : "ACT";
            let JobTitlerates = jobTitlesRateModel.getRates(jobTitleExternalID, month, year);
            let rateString = 'JobTitle:'+jobTitleExternalID + `, Regular Rate: ${JobTitlerates.regularRate.value} ${JobTitlerates.regularRate.currency}, `;
                //rateString += `Overtime Rate: ${JobTitlerates.overtimeRate.value} ${JobTitlerates.overtimeRate.currency}`;

            const recData = value.getMonthlyRecord(year, month);
            if (recData && j < (numOfMonths * NUM_OF_DATA_COLUMNS)) {
                if (j % 2 === 0) {
                    dataToSet = laborBudget === "Task Assignment" ? recData.taskAssignment : recData.projectAssignment;
                    forecstUntillEOM = Number(laborBudget === "Task Assignment" 
                        ? value.forecastTaskAssignmentUntilEOM 
                        : value.forecastProjectAssignmentUntilEOM).toFixed(5);
                    
                } else {
                    dataToSet = recData.actualApproved;
                }
                //add to the hint the total forecasted until the end of the month
                if (isCurrentMonth(dateCopy)) {
                    rateString+="| Forecast Until EOM = " + forecstUntillEOM;
                    }
    
                const cell = $("<td>")
                    .attr("periodKey", `${recKey}-${collType}`)
                    .attr("cellVal", dataToSet)
                    .attr("title", rateString) // Add title attribute with rateString
                    .text(Number(dataToSet).toFixed(2));

                if (!(j % 2 === 0)) {
                    cell.css('background', '#f0f5f5');
                }
                if (month === 1 && (j % 2 === 0)) {
                    cell.addClass("year-seprator");
                }
                row.append(cell);
            } else {
                const emptyCell = $("<td>").attr("periodKey", `${recKey}-${collType}`).attr("cellVal", 0).html("&nbsp;");
                if (month === 1 && (j % 2 === 0)) {
                    emptyCell.addClass("year-seprator");
                }
                if (!(j % 2 === 0)) {
                    emptyCell.css('background', '#f0f5f5');
                }
                row.append(emptyCell);
            }
            if (!(j % 2 === 0)) {
                dateCopy.setMonth(dateCopy.getMonth() + 1);
            }
        }
        tbodyTbl.append(row);
    }

    // Call for adding the total row
    addTotalRow(tbodyTbl, numOfMonths);
    API.Utils.endLoading();
}


//draw trhe financial model
function drawFinancialData(numOfMonths) {
    var exchangeRateVal,titleTXT;
    var jobTitleExternalID;
    // Clear table first
    removeTBodyRows();

    // Sort dataModel by userDiscipline and then by userDisplayName
    const sortedData = Array.from(dataModel.values()).sort((a, b) => {
        const disciplineCompare = a.userDiscipline.localeCompare(b.userDiscipline);
        if (disciplineCompare !== 0) return disciplineCompare;
        return a.userDisplayName.localeCompare(b.userDisplayName);
    });

    // Show or hide the table based on the data
    if (dataModel.size > 0) {
        $("#data-table").show();
    } else {
        $("#data-table").hide();
    }

    tbodyTbl = $("#data-table tbody");
    const date = new Date(fromStartDate);

    for (const value of sortedData) {
        const row = $('<tr>');
        jobTitleExternalID=value.userJobTitleExternalID;

        // Add discipline
        row.append($("<td>").addClass("roleCell").text(value.userDiscipline));

        // Add user name
        row.append($("<td>").addClass("roleCell").attr("title", value.userJobTitle).text(value.userDisplayName));

        // Budget
        let recKey = "budget";
        let dataToSet = Number(value.calculateTotalWithExchangeRate(recKey));
        row.append($("<td>").css('background', '#ffffe6').attr("periodKey", recKey).attr("cellVal", dataToSet).text(dataToSet.formatMoney(2, ',', '.')));

        // Actual Booked
        recKey = "actualBooked";
        dataToSet = Number(value.calculateTotal(recKey));
        row.append($("<td>").css('background', '#ffffe6').attr("periodKey", recKey).attr("cellVal", dataToSet).text(dataToSet.formatMoney(2, ',', '.')));

        // Remaining Forecast Fees
        recKey = "Remaining_Forecast_Fees";
        dataToSet = laborBudget === "Task Assignment"
            ? value.getRemainingForecastFeesTaskAssignment()
            : value.getRemainingForecastFeesProjectAssignment();
        row.append($("<td>").css('background', '#ffffe6').attr("periodKey", recKey).attr("cellVal", dataToSet).text(dataToSet.formatMoney(2, ',', '.')));

        // EAC Fees
        recKey = "EAC_Fees";
        const eacFees = dataToSet + Number(value.calculateTotal("actualBooked"));
        row.append($("<td>").css('background', '#ffffe6').attr("periodKey", recKey).attr("cellVal", eacFees).text(eacFees.formatMoney(2, ',', '.')));

        // Render monthly data
        const dateCopy = new Date(fromStartDate);
        for (let j = 0; j < (numOfMonths * NUM_OF_DATA_COLUMNS); j++) {
            const year = dateCopy.getFullYear();
            const month = dateCopy.getMonth() + 1;
            recKey = `${year}-${month}`;
            const collType = j % 2 === 0 ? "BUD" : "ACT";
            //get job title rates fot the hint
            let JobTitlerates = jobTitlesRateModel.getRates(jobTitleExternalID, month, year);
            let rateString = 'JobTitle:'+jobTitleExternalID + `, Regular Rate: ${JobTitlerates.regularRate.value} ${JobTitlerates.regularRate.currency}, `;
               // rateString += `Overtime Rate: ${JobTitlerates.overtimeRate.value} ${JobTitlerates.overtimeRate.currency}`;

            const recData = value.getMonthlyRecord(year, month);
            if (recData && j < (numOfMonths * NUM_OF_DATA_COLUMNS)) {
                //dataToSet = j % 2 === 0 ? recData.budget : recData.actualBooked;
                try{
                    if(j% 2===0){                    
                    exchangeRateVal = recData.exchangeRate;                    
                    titleTXT = "Exchange Rate: "+Number(exchangeRateVal).toFixed(4) +", Value in AUD: "+Number(recData.budget).toFixed(2); 		
                      if (currencyType !== "AUD") { 
                        dataToSet = recData.budget*exchangeRateVal;
                      }	else {	
                         dataToSet = recData.budget;
                      }
                    }  else {                          
                    titleTXT="";			
                       dataToSet = recData.actualBooked;
                    }
                    }catch (err){
                        titleTXT="";
                        dataToSet=0;	
                    }	
                    titleTXT+="| " + rateString;			
                    const cell = $("<td>")
                    .attr("periodKey", `${recKey}-${collType}`)
                    .attr("cellVal", dataToSet)
                    .attr("title", titleTXT)  // Add title attribute for tooltip
                    .text(dataToSet.formatMoney(0, ',', '.'));

                if (!(j % 2 === 0)) {
                    cell.css('background', '#f0f5f5');
                }
                if (month === 1 && (j % 2 === 0)) {
                    cell.addClass("year-seprator");
                }
                row.append(cell);
            } else {
                const emptyCell = $("<td>").attr("periodKey", `${recKey}-${collType}`).attr("cellVal", 0).html("&nbsp;");
                if (month === 1 && (j % 2 === 0)) {
                    emptyCell.addClass("year-seprator");
                }
                if (!(j % 2 === 0)) {
                    emptyCell.css('background', '#f0f5f5');
                }
                row.append(emptyCell);
            }
            if (!(j % 2 === 0)) {
                dateCopy.setMonth(dateCopy.getMonth() + 1);
            }
        }
        tbodyTbl.append(row);
    }

    // Add totals row
    addTotalRow(tbodyTbl, numOfMonths);
    API.Utils.endLoading();
}


//safe convert exchange 
function convertValueUsingExchangeRate(value, exchangeRate) {
    try {
        // Validate inputs are numeric
        if (isNaN(value)) {
            console.warn("Invalid value: Non-numeric input. Defaulting to 0.");
            return 0;
        }

        if (isNaN(exchangeRate)) {
            console.warn("Invalid exchange rate: Non-numeric input. Defaulting to 0.");
            return 0;
        }

        // Perform the multiplication
        return value * exchangeRate;
    } catch (error) {
        // Gracefully handle unexpected errors
        console.error("An unexpected error occurred:", error.message);
        return 0;
    }
}

//will load job titles rate table 
function loadJobTitlesRates(numOfMonths){	
	if(projectRateCard){
      var resultQry = new Array();
            
      const query = "Select RateFor.JobTitle.Name,RateFor.JobTitle.externalid,RateType.Name,EffectiveFrom,EffectiveTo,RegularRate.value,RegularRate.Currency,OvertimeRate.Value,OvertimeRate.Currnecy from Rate where RateType='/RateType/Revenue' and RateFor in(Select ExternalId from RateCardItem where RateCard='"+projectRateCard+"') limit 5000 offset ";
        
      //load data with pagings 
      queryMore(0, resultQry, parseJobTitlesRates, query,numOfMonths);
	}   
}

//will load the resource link data model
function loadRegularResourceLink(numOfMonths){
    var resultQry = new Array();
    
    const query = "Select WorkItem.externalid,WorkItem.State.Name,WorkItem.SYSID,WorkItem.Name,externalid,Resource.externalID,Resource.DisplayName from RegularResourceLink where WorkItem in("+leafTasksIds +") limit 5000 offset ";
   //load data with pagings 
   queryMore(0, resultQry, parseRegularResourceLinkManager, query,numOfMonths);
} 

//will iterate on the resource assignment records and load the data model
function parseRegularResourceLinkManager(result, numOfMonths){
    for (let i = 0; i < result.length; i++) {
        const linkData = result[i];
        const externalid = linkData.externalid;
        const resourceExternalID= linkData.Resource.externalID;
        const displayName  = linkData.Resource.DisplayName;
        const workItemExternalID = linkData.WorkItem.externalid; // Work item external ID
        const workItemSYSID = linkData.WorkItem.SYSID; // Work item system ID
        const workItemName = linkData.WorkItem.Name; // 
        regularResourceLinkManager.addRecord(externalid, resourceExternalID, displayName,workItemExternalID,workItemSYSID,workItemName);
    }
    //load the job title rates
   loadJobTitlesRates(numOfMonths); 
}

// takes the result (JSON array) and numOfMonths parameters, creates RateRecord instances, and adds them to the jobTitlesRateModel
function parseJobTitlesRates(result, numOfMonths) {
    for (let i = 0; i < result.length; i++) {
        const rateData = result[i];

        // Extract values from the JSON
        const id = rateData.id;
        const jobTitleName = rateData.RateFor.JobTitle.Name;
        const externalId = rateData.RateFor.JobTitle.externalid;
        const rateTypeName = rateData.RateType.Name;
        const effectiveFrom = rateData.EffectiveFrom;
        const effectiveTo = rateData.EffectiveTo;
        const regularRateValue = rateData.RegularRate.value;
        const regularRateCurrency = rateData.RegularRate.currency;
        const overtimeRateValue = rateData.OvertimeRate.value;
        const overtimeRateCurrency = rateData.OvertimeRate.currency;

        // Create a new RateRecord instance
        const record = new RateRecord(
            id,
            jobTitleName,
            externalId,
            rateTypeName,
            effectiveFrom,
            effectiveTo,
            regularRateValue,
            regularRateCurrency,
            overtimeRateValue,
            overtimeRateCurrency
        );

        // Add the record to the RateModel
        jobTitlesRateModel.addRecord(record);
    }  
    //console.log("==== before finalizeRecords() Start ======= ")
   // jobTitlesRateModel.print();
   // console.log("==== before finalizeRecords() End ======= ")
    // Adjust dates and handle defaults
    jobTitlesRateModel.finalizeRecords(); //fix and sort the exchange rates array so it can support the search of rates per month 
   // jobTitlesRateModel.print();
    
     // Now that the model is full update the projectRemainingForecastFeesModel with all the values so the data can be saved
    projectRemainingForecastFeesModel.updateRatesInYearMonthlyRecords();//will update the project forecast model with job titles rates
    if (currencyType !== "AUD"){ //in case the currency is not AUD update the project forecast model with exchange rates
        projectRemainingForecastFeesModel.updateCurrencyExchanges();
    }
    //now uypdate project forecast model with the resource links
    projectRemainingForecastFeesModel.updateResourceLinkExternalIDs();

    // Ensure current-month assignmentInDays reflect the UI's forecast until EOM values
    projectRemainingForecastFeesModel.syncThisMonthFromDataModel();

    // Now that the model is full, call to draw it  
    drawData(null, numOfMonths);
    console.log('Rates/job titles applied: using ensureEnableButtonReady instead of timed enable');
    ensureEnableButtonReady();//enable the save button after load

    // If the project model was built at least twice and we haven't printed yet, print sample now
    try {
        if (!projectRemainingForecastPrinted && projectRemainingForecastBuildCount >= 2) {
            projectRemainingForecastPrinted = true;
            printProjectRemainingForecastSample();
        }
    } catch (e) {
        console.warn('Error attempting to print projectRemainingForecast sample after rates applied', e);
    }

    // If we're in a Task view (not Project) print the task-level sample once for debugging
    try {
        if (WorkItemtype !== "Project" && !projectRemainingForecastPrintedTask) {
            projectRemainingForecastPrintedTask = true;
            // workItemExternalID is available in the panel context and should contain the current task external ID
            if (typeof workItemExternalID !== 'undefined' && workItemExternalID) {
                // Ensure the project model has the work item key as stored (externalID should be like '/Task/123')
                // Print the authoritative UserRecord values for this task (these are the values used by task-level save)
                try { printTaskUserRecordSample(workItemExternalID); } catch (e) { console.warn('printTaskUserRecordSample not available', e); }
            } else {
                // If workItemExternalID isn't set, try constructing from currentProject if available
                if (typeof data !== 'undefined' && data.currentProject && data.currentProject.ExternalID) {
                    try { printTaskUserRecordSample(data.currentProject.ExternalID); } catch (e) { console.warn('printTaskUserRecordSample not available', e); }
                }
            }
        }
    } catch (e) {
        console.warn('Error attempting to print taskRemainingForecast sample after rates applied', e);
    }
}


function buildDataModel(result, numOfMonths) {
    
    // Iterate over each record in the results to build the data model
    for (let i = 0; i < result.length; i++) {
        const capacityRecord = result[i];
        let period, forecast,taskAssignment, actualApproved, actualPending, periodYear, periodMonth, userDisplayName,userDiscipline, userId,userJobTitle,userJobTitleEId;
        let workItemType;

        workItemType = capacityRecord.WorkITem.EntityType;//will hold the work item type

        // Determine the user
        if (capacityRecord.User) {
            userId = capacityRecord.User.id;
            userDisplayName = capacityRecord.User.DisplayName;
            userDiscipline = capacityRecord.User?.C_Discipline?.name ?? "";

        } else {
            userId = "No User";
        }

        if (capacityRecord.User.JobTitle) {
            userJobTitle = capacityRecord.User.JobTitle.Name;
            userJobTitleEId = capacityRecord.User.JobTitle.externalid;
        } else {
            userJobTitle = "No Job Title";
        }
        
        // Try-catch blocks to safely extract values
        try { 
            actualApproved = Number(capacityRecord.ActualApproved?.value) /HOURS_PER_DAY|| 0;
        } catch (err) { actualApproved = 0; }
        
        try {
            actualPending = Number(capacityRecord.ActualPending?.value)/HOURS_PER_DAY || 0;
        } catch (err) { actualPending = 0; }
        
        //taskAssignment
        try {
            taskAssignment = Number(capacityRecord.Work?.value) /HOURS_PER_DAY|| 0;
        } catch (err) { taskAssignment = 0; }

        try {
            forecast = Number(capacityRecord.ProjectAssignment?.value)/HOURS_PER_DAY || 0;
        } catch (err) { forecast = 0; }
        
        // Calculate the date, year, and month
        period = new Date(capacityRecord.Date);
        periodYear = getDateYear(period);
        periodMonth = getDateMonth(period);
        
        // Format year-month as YYYY-MM for record tracking
        //const dateKey = `${periodYear}-${String(periodMonth).padStart(2, '0')}`;
        
        // Check if the user record already exists in the dataModel
        let userRecord = dataModel.get(userId);
        
        if (!userRecord) {
            // Create a new UserRecord if it doesn't exist
            userRecord = new UserRecord(userId,userDisplayName,thisMonday,userJobTitle,userJobTitleEId,userDiscipline);
            dataModel.set(userId, userRecord);
        }
        
        if(laborBudget=="Task Assignment"){ //#### Changed by Tal - 16/03/2025 
            //addOrUpdateMonthlyRecord(year, month, projectAssignment = 0, taskAssignment = 0, actualApproved = 0) 
             // Update the user's monthly record with the new data
             if( workItemType=="Task"){
                userRecord.addOrUpdateMonthlyRecord(periodYear, periodMonth,forecast, taskAssignment, actualApproved + actualPending);
             }           
        } else{
            // Update the user's monthly record with the new data
            userRecord.addOrUpdateMonthlyRecord(periodYear, periodMonth, forecast,taskAssignment, actualApproved + actualPending);
        }
       
    }

    // Output the JSON format if needed
    console.log(Array.from(dataModel.values()).map(record => record.userKey));
}

function buildThisMonthForecastDataModel(result, numOfMonths) {
    
    // Iterate over each record in the results to build this month's forecast data model
    for (let i = 0; i < result.length; i++) {
        const capacityRecord = result[i];
        let forecast, taskAssignment, userDisplayName,userDiscipline, userId, userJobTitle,userJobTitleEId;
        
        // Determine the user
        if (capacityRecord.User) {
            userId = capacityRecord.User.id;
            userDisplayName = capacityRecord.User.DisplayName;
            userDiscipline  = capacityRecord.User?.C_Discipline?.name ?? "";

        } else {
            userId = "No User";
        }

         // Determine the job Title
         if (capacityRecord.User.JobTitle) {
            userJobTitle = capacityRecord.User.JobTitle.Name;
            userJobTitleEId = capacityRecord.User.JobTitle.externalid;
        } else {
            userJobTitle = "No Job Title";
        }

        // Safely extract forecast and task assignment values
        try {
            taskAssignment = Number(capacityRecord.Work?.value) / HOURS_PER_DAY || 0;
        } catch (err) { taskAssignment = 0; }

        try {
            forecast = Number(capacityRecord.ProjectAssignment?.value) / HOURS_PER_DAY || 0;
        } catch (err) { forecast = 0; }

        // Check if the user record already exists in the dataModel
        let userRecord = dataModel.get(userId);
        
        if (!userRecord) {
            // Create a new UserRecord if it doesn't exist
            userRecord = new UserRecord(userId, userDisplayName, thisMonday,userJobTitle,userJobTitleEId,userDiscipline);
            dataModel.set(userId, userRecord);
        }

        // Use the class setters to set the forecast and task assignment for the user
        userRecord.setForecastTaskAssignmentUntilEOM(taskAssignment);
        userRecord.setForecastProjectAssignmentUntilEOM(forecast);
    }

    // Output the JSON format if needed for debugging
   // console.log(Array.from(dataModel.values()).map(record => ({
   //     userKey: record.userKey,
  // //     forecastTaskAssignmentUntilEOM: record.forecastTaskAssignmentUntilEOM,
 //       forecastProjectAssignmentUntilEOM: record.forecastProjectAssignmentUntilEOM
   // })));
   effortModelLoaded=true; //mmodel loaded, enable switch without reload
   
   //if project is loaded add this month data to the ProjectRemainingForecastFeesModel 
   if(WorkItemtype === "Project"){
     buildProjectRemainingForecastFeesModel(result, numOfMonths);
   }
   //now load the regular resource link model
   loadRegularResourceLink(numOfMonths);
   
}

//will get the number of years between the start and end dates for calcualting the last cell int he years-raw
function getYearsBetweenDates() {
    // Validate input dates
    var startDate = new Date(fromStartDate);
    var endDate = new Date(toEndDate);

    if (isNaN(startDate) || isNaN(endDate)) {
        console.log("Invalid date input");
        return 0;
    }

    // Calculate the difference in years
    var yearsDifference = endDate.getFullYear() - startDate.getFullYear();

    return yearsDifference;
}


// Helper functions
function getDateYear(date) {
    return date.getFullYear();
}

function getDateMonth(date) {
    return date.getMonth() + 1; // Month is 0-based in JavaScript, so add 1
}


//will be called to clear the table rows 
function removeTBodyRows() {
    $("#data-table tbody tr").each(function () {
        this.parentNode.removeChild(this);
    });
}


//will be called for calcualting the totals per column and ading the total row
function addTotalRow(tbodyTbl,numOfMonths){
	
	var cell, yYear,mMonth,recKey,collType,columnKey,totVal;
		
	totVal = new Number(0);
	
	//adjust start date to begining of month 
    var date = new Date(fromStartDate);
	var numOfDataCols = (numOfMonths*NUM_OF_DATA_COLUMNS);
	
	//first creat the Total cell 
	 row = $('<tr>');
	 cell = $("<td colspan='2'>Total</td>");
	 row.append(cell);
	 cell.addClass("summaryTotalCell");

     // add the summary totals 

    if(selectedForecastType === FORECAST_TYPES.FINANCIALS){
        recKey ="budget";
        totVal = calculateColumnSummary(recKey);
        cell = $("<td>"+ totVal.formatMoney(0, ',', '.')  +"</td>");  
        cell.addClass("summaryTotalCell");
        row.append(cell);	

        recKey ="actualBooked"; 
        totVal = calculateColumnSummary(recKey);
        cell = $("<td>"+ totVal.formatMoney(0, ',', '.')  +"</td>");  
        cell.addClass("summaryTotalCell");
        row.append(cell);	

        recKey ="Remaining_Forecast_Fees";
        totVal = calculateColumnSummary(recKey);
        cell = $("<td>"+ totVal.formatMoney(0, ',', '.')  +"</td>");  
        cell.addClass("summaryTotalCell");
        row.append(cell);	

        recKey = "EAC_Fees"
        totVal = calculateColumnSummary(recKey);
        cell = $("<td>"+ totVal.formatMoney(0, ',', '.')  +"</td>");  
        cell.addClass("summaryTotalCell");
        row.append(cell);

    }else{

        if(laborBudget=="Task Assignment"){
            recKey = "taskAssignment";
          }else{
            recKey = "projectAssignment";
          }			
          totVal = calculateColumnSummary(recKey);
          cell = $("<td>"+ totVal.toFixed(1) +"</td>");
          cell.addClass("summaryTotalCell");
          row.append(cell);	  

          recKey = "actualApproved";
          totVal = calculateColumnSummary(recKey);
          cell = $("<td>"+ totVal.toFixed(1) +"</td>");
          cell.addClass("summaryTotalCell");
          row.append(cell);	


          recKey = "Forecast_Effort_Balance";
          totVal = calculateColumnSummary(recKey);
          cell = $("<td>"+ totVal.toFixed(1) +"</td>");
          cell.addClass("summaryTotalCell");
          row.append(cell);

    }

	
	for (var j = 0; j <(numOfMonths*NUM_OF_DATA_COLUMNS);j++) {		  
		yYear   = date.getFullYear();
		mMonth  = date.getMonth() + 1;
		recKey = yYear+"-"+mMonth;
		if (j% 2===0){		
            if (selectedForecastType === FORECAST_TYPES.FINANCIALS){
                collType ="BUD";
            }else {
                collType = "FOR";//will hold the key column type for totals identification   
            }		
			
		}  else {					
			collType  = "ACT";
	    }
		
		columnKey = recKey + "-"+ collType;
		
		totVal = calculateColumnSummary(columnKey);

        if (selectedForecastType === FORECAST_TYPES.FINANCIALS){
            cell = $("<td>"+ totVal.formatMoney(0, ',', '.')  +"</td>");  
        }else {
            cell = $("<td>"+ totVal.toFixed(1) +"</td>");  
        }	
		
		cell.addClass("summaryTotalCell");
		if ((mMonth==1 && (j% 2===0)) || (j==numOfDataCols)){//on Jan and on ETC add the year seprator
			  cell.addClass("year-seprator");
		} 
		row.append(cell);	
		//move month ahead on evry second round when J is odd
		if(!(j% 2===0)){
		  date.setMonth(date.getMonth() + 1);//move the month 1 ahead		  
		}
	}
	 tbodyTbl.append(row);
}

//will get a month to calculate its column and return the sum vallue
function calculateColumnSummary(monthVal)
{
    var colData, calculatedSum, tdVal;
    calculatedSum = new Number(0);
    //colData = $("#dashTable td[projdateid*='_06/16']");  
    colData = $("#dashTable td[periodKey*='" + monthVal + "']");
    
    //console.log(colData);
    try
    {
        colData.each(function(index, element)
        {
            var elem = $(element);
            if ($(element).attr('cellVal'))
            {
                tdVal = new Number($(element).attr('cellVal'));
                calculatedSum += tdVal;
                // console.log(calculatedSum);
            }
        });
    } catch (err)
    {
        calculatedSum = new Number(0);
    }
    return calculatedSum;
}



/**
 This function, `getThisMondayOrFirstWorkingDay`, calculates the date of the current week's Monday. 
 If this Monday falls in the previous month, it instead returns the first working day (non-weekend) of the current month.
 Here's a breakdown:
    1. Determine "this Monday"**: Based on today's date, it calculates the most recent Monday.
    2. Check the month**: If this Monday belongs to the previous month, the function shifts focus to the current month.
    3. Find the first working day**: It identifies the first weekday of the current month by adjusting for weekends (if the 1st is a Saturday or Sunday).
    4. Return the date**: It provides the date of "this Monday" or the first working day of the current month in `YYYY-MM-DD` format.
 */

    function getThisMondayOrFirstWorkingDay() {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 (Sunday) to 6 (Saturday)
        let daysToMonday = 1 - dayOfWeek; // Monday is 1
    
        // If today is Sunday, set daysToMonday to 1 for the next day (Monday)
        if (dayOfWeek === 0) {
            daysToMonday = 1;
        }
    
        // Calculate this Monday's date
        const thisMonday = new Date(today);
        thisMonday.setDate(today.getDate() + daysToMonday);
    
        // Check if this Monday is in the previous month
        if (
            thisMonday.getMonth() < today.getMonth() ||
            thisMonday.getFullYear() < today.getFullYear()
        ) {
            // If so, get the first day of the current month
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
            // Adjust to the first working day if the 1st is on a weekend
            let firstWorkingDay = new Date(firstDayOfMonth);
            const firstDayOfWeek = firstDayOfMonth.getDay();
            if (firstDayOfWeek === 0) {
                firstWorkingDay.setDate(firstDayOfMonth.getDate() + 1);
            } else if (firstDayOfWeek === 6) {
                firstWorkingDay.setDate(firstDayOfMonth.getDate() + 2);
            }
    
            return formatLocalISODate(firstWorkingDay);
        }
    
        return formatLocalISODate(thisMonday);
    }
    
//will give you the date as YYYY-MM-DD in local time, regardless of the browser's timezone (Israel, US, etc.).    
function formatLocalISODate(date) {
    const pad = n => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Function to get the last day of the month for a given date (thisMonday)
function getLastDayOfThisMondayMonth(thisMonday) {
    const year = thisMonday.getFullYear();
    const month = thisMonday.getMonth();
    const retDate = new Date(year, month + 1, 0); // Last day of the month
    return `${retDate.getFullYear()}-${String(retDate.getMonth() + 1).padStart(2, '0')}-${String(retDate.getDate()).padStart(2, '0')}`;
}


// Function to get the year and month of the next month after a given date (thisMonday)
function getNextMonthYear(thisMonday) {
    const year = thisMonday.getFullYear();
    const month = thisMonday.getMonth();
    
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;

    return { year: nextYear, month: nextMonth + 1 }; // month is 1-indexed (1 = January, 12 = December)
}

// returns the ISO date string (format YYYY-MM-DD) for the first day of the next month:
function getFirstDateOfNextMonth() {
    const today = new Date();

    // Move to the first day of the next month
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    // Return in ISO format (YYYY-MM-DD)
    //return nextMonth.toISOString().split('T')[0];
    return formatLocalISODate(nextMonth);
}

/**
 * Function to check if a date is between thisMonday and endDate.
 * 
 *  */
function isDateBetween(date, thisMonday, endDate) {
   // Helper to normalize date to YYYY-MM-DD (removes time zones and time)
   function normalizeDate(dateInput) {
    const d = new Date(dateInput);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0'); // Ensure 2 digits
    const day = String(d.getDate()).padStart(2, '0');        // Ensure 2 digits
    return `${year}-${month}-${day}`;
}

    // Normalize all dates
    const targetDate = normalizeDate(date);
    const startOfWeek = normalizeDate(thisMonday);
    const endOfRange = normalizeDate(endDate);

    // Compare as plain strings (safe because they are in YYYY-MM-DD format)
    return targetDate >= startOfWeek && targetDate <= endOfRange;
}

//will get the list of tasks id's from the panel and return it in a format thatc an be used for querying the API
function formatTaskList(input) {
    // Remove the last comma if it exists
    const trimmedInput = input.endsWith(",") ? input.slice(0, -1) : input;

    // Split the input into an array of IDs
    const ids = trimmedInput.split(",");

    // Map the IDs to the desired format
    const formattedIds = ids.map(id => `'/Task/${id}'`);

    // Join the formatted IDs back into a single string
    return formattedIds.join(",");
}

//will be used for downloading the model into excel file
function downloadExcel() {
    const excelData = [];
    const columns = [
        "Discipline",
        "Resource",
        "Job Title",
        "Standard Rate",
        "Date",
        "Month",
        "Year",
        "Forecast",
        "Actual",
        "Forecast Effort Balance (D)",
        "Budget",
        "Actual Booked",
        "Exchange Rate",
        "Currency Symbol",
        "Remaining Forecast Fees",
        "EAC Fees",
        "Forecast Until EOM"
    ];

    let date = new Date(fromStartDate);
    const endDate = new Date(toEndDate);

    for (const [key, userRecord] of dataModel) {
        const discipline = userRecord.userDiscipline;
        const resourceName = userRecord.userDisplayName;
        const jobTitle = userRecord.userJobTitle;

        let standardRate = 0;

        // Calculate totals once per resource
        const totalActualBooked = userRecord.calculateTotal("actualBooked");
        const remainingForecastFees = laborBudget === "Task Assignment"
            ? userRecord.getRemainingForecastFeesTaskAssignment()
            : userRecord.getRemainingForecastFeesProjectAssignment();
        const eacFees = totalActualBooked + remainingForecastFees;
        
        //get forecast effort balance once per user record 
        let forecastEffortBalance = 0;
        if (laborBudget === "Task Assignment") {
            forecastEffortBalance = userRecord.getForecastEffortBalanceTaskAssignment();
        } else {
            forecastEffortBalance = userRecord.getForecastEffortBalanceProjectAssignment();
        }
        
        // Reset date for row-level processing
        date = new Date(fromStartDate);

        while (date <= endDate) {
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const day = 1;
            const record = userRecord.getMonthlyRecord(year, month);

            let forecast = 0;
            let actual = 0;
            
            let budget = 0;
            let actualBooked = 0;
            let exchangeRate = 0;
            let currencySymbol = currencyType;
            let forecastUntilEOM = 0; // Default to 0 for all months

            // Fetch job title rates for the current month and year
            const jobTitleRates = jobTitlesRateModel.getRates(userRecord.userJobTitleExternalID, month, year);
            standardRate = jobTitleRates?.regularRate?.value || 0;

            if (record) {
                if (laborBudget === "Task Assignment") {
                    forecast = record.taskAssignment || 0;                    
                    if (isCurrentMonth(date)) {
                        forecastUntilEOM = userRecord.forecastTaskAssignmentUntilEOM;
                    }
                } else {
                    forecast = record.projectAssignment || 0;                    
                    if (isCurrentMonth(date)) {
                        forecastUntilEOM = userRecord.forecastProjectAssignmentUntilEOM;
                    }
                }
                actual = record.actualApproved || 0;
                budget = convertValueUsingExchangeRate(record.budget || 0, record.exchangeRate || 1);
                actualBooked = record.actualBooked || 0;
                exchangeRate = record.exchangeRate || 0;
            }

            // Use a proper Date object for Excel export
            const formattedDate = new Date(year, month - 1, day);

            // Add record to the excel data
            const row = {
                Discipline:discipline,
                Resource: resourceName,
                "Job Title": jobTitle,
                "Standard Rate": standardRate,
                Date: formattedDate,
                Month: month,
                Year: year,
                Forecast: Number(forecast),
                Actual: Number(actual),
                "Forecast Effort Balance (D)": Number(forecastEffortBalance),
                Budget: Number(budget),
                "Actual Booked": Number(actualBooked),
                "Exchange Rate": Number(exchangeRate),
                "Currency Symbol": currencySymbol,
                "Remaining Forecast Fees": Number(remainingForecastFees),
                "EAC Fees": Number(eacFees),
                "Forecast Until EOM": forecastUntilEOM // Set to a value only for the current month
            };

            // Add a comment for Forecast Until EOM if it's the current month
            if (forecastUntilEOM > 0) {
                row["_comment"] = `Forecast Until EOM (This Monday: ${thisMonday})`;
            }

            excelData.push(row);

            date.setMonth(date.getMonth() + 1);
        }
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const fileName = `${nameOfWorkItem}_${timestamp}.xlsx`;

    // Add comments to Excel cells (only for Forecast Until EOM)
    const options = {
        comments: excelData.map(row => row["_comment"] || null) // Ensure other rows have no comments
    };

    createExcelFile(excelData, columns, fileName, options);
}


function createExcelFile(data, columns, fileName) {
    const worksheet = XLSX.utils.json_to_sheet(data, { header: columns });
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

    // Generate Excel file and trigger download
    XLSX.writeFile(workbook, fileName);
}


// Helper function to convert a value to the project currency
function convertToProjectCurrency(value, sourceCurrency, targetCurrency, exchangeRate, month, year) {
    try {
        if (isNaN(value) || value === 0) return 0;
        if (sourceCurrency === targetCurrency || !sourceCurrency) return value;
        if (isNaN(exchangeRate) || exchangeRate === 0) {
            exchangeRate = exchangeTable.getExchangeRateForCurrencyAndMonth(targetCurrency, month, year);
        }
        return value * exchangeRate;
    } catch (error) {
        console.error(`Error converting value to ${targetCurrency}:`, error.message);
        return 0;
    }
}

// Debug helper: print a detailed sample for a specific task (work item)
// Usage from console: printTaskRemainingForecastSample('/Task/12345')
function printTaskRemainingForecastSample(taskExternalID) {
    if (!projectRemainingForecastFeesModel) {
        console.log('projectRemainingForecastFeesModel not initialized');
        return;
    }

    if (!taskExternalID) {
        console.log('Please provide taskExternalID, e.g. printTaskRemainingForecastSample("/Task/123")');
        return;
    }

    const workItem = projectRemainingForecastFeesModel.getWorkItem(taskExternalID);
    if (!workItem) {
        console.log(`No work item found in project model for ${taskExternalID}`);
        return;
    }

    console.log(`--- Task Remaining Forecast Sample for ${taskExternalID} ---`);
    console.log(`WorkItem: externalID=${workItem.externalID}, SYSID=${workItem.workItemSysId}, name=${workItem.workItemName}`);

    const resourceLinks = Array.from(workItem.resourceLinks.values());
    if (resourceLinks.length === 0) {
        console.log('  (no resource links)');
    }

    // Work-item level aggregates
    let wi_sumHours = 0;
    let wi_sumFeesSource = 0;
    let wi_sumFeesConverted = 0;

    resourceLinks.forEach((rl, rlIndex) => {
        try {
            console.log(`  ResourceLink ${rlIndex + 1}: resourceName=${rl.resourceName}, resourceExternalId=${rl.resourceExternalId}, jobTitleExternalID=${rl.jobTitleExternalID}, jobTitleName=${rl.jobTitleName}, resourceLinkExternalID=${rl.resourceLinkExternalID}`);

            // Lookup matching user in dataModel
            const userKey = '/User/' + rl.resourceExternalId;
            const userRec = dataModel.get(userKey);
            if (userRec) {
                console.log(`    -> dataModel user found: userKey=${userKey}, forecastTaskAssignmentUntilEOM=${userRec.forecastTaskAssignmentUntilEOM}, forecastProjectAssignmentUntilEOM=${userRec.forecastProjectAssignmentUntilEOM}`);
            } else {
                console.log(`    -> dataModel user NOT found for userKey=${userKey}`);
            }

            // reset per-resource accumulators
            rl._sumHours = 0;
            rl._sumFeesSource = 0;
            rl._sumFeesConverted = 0;

            if (!rl.yearMonthlyRecords || rl.yearMonthlyRecords.length === 0) {
                console.log('    (no yearMonthlyRecords)');
                return;
            }

            rl.yearMonthlyRecords.forEach((yrRec) => {
                try {
                    const monthStr = `${yrRec.year}-${String(yrRec.month).padStart(2, '0')}`;
                    const assignmentDays = typeof yrRec.assignmentInDays === 'number' ? yrRec.assignmentInDays : Number(yrRec.assignmentInDays) || 0;
                    const assignmentHours = assignmentDays * HOURS_PER_DAY;

                    // Normalize rate
                    let rateValue = null;
                    let rateCurrency = '';
                    let rateJson = null;
                    if (yrRec.rate) {
                        if (yrRec.rate.regularRate && typeof yrRec.rate.regularRate.value !== 'undefined') {
                            rateValue = yrRec.rate.regularRate.value;
                            rateCurrency = yrRec.rate.regularRate.currency || '';
                        } else if (yrRec.rate.regular && typeof yrRec.rate.regular.value !== 'undefined') {
                            rateValue = yrRec.rate.regular.value;
                            rateCurrency = yrRec.rate.regular.currency || '';
                        } else if (typeof yrRec.rate === 'object') {
                            try { rateJson = JSON.stringify(yrRec.rate); } catch (e) { rateJson = String(yrRec.rate); }
                        } else {
                            rateValue = yrRec.rate;
                        }
                    }

                    const exch = (yrRec.currencyExchange !== undefined && yrRec.currencyExchange !== null) ? yrRec.currencyExchange : null;
                    const rateDisplay = rateValue !== null && rateValue !== undefined ? `${rateValue}` : (rateJson || '0');
                    const currencySuffix = rateCurrency ? ` ${rateCurrency}` : '';

                    // calculate fees in source currency and converted to project currency
                    const hrs = Number(assignmentHours) || 0;
                    const rVal = Number(rateValue) || 0;
                    const feesSource = hrs * rVal; // in source currency
                    const feesConverted = convertToProjectCurrency(feesSource, rateCurrency || '', currencyType, exch, yrRec.month, yrRec.year);

                    // accumulate per-resource totals (we'll define sums on outer scope)
                    rl._sumHours += hrs;
                    rl._sumFeesSource += feesSource;
                    rl._sumFeesConverted += feesConverted;

                    console.log(`    ${monthStr}: assignmentDays=${assignmentDays}, assignmentHours=${assignmentHours}, isCurrentMonth=${!!yrRec.isCurrentMonth}` +
                        `, rate=${rateDisplay}${currencySuffix}, currencyExchange=${exch}, feesSource=${feesSource.toFixed(2)}${rateCurrency || ''}, feesConverted=${feesConverted.toFixed(2)}${currencyType}`);
                    if (rateJson) console.log(`      rateObject: ${rateJson}`);

                } catch (e) {
                    console.warn('    Error printing yearMonthlyRecord', e, yrRec);
                }
            });

            // After listing months for this resource, print per-resource totals
            try {
                console.log(`    -> Resource totals: totalHours=${(rl._sumHours).toFixed(2)}, totalFeesSource=${(rl._sumFeesSource).toFixed(2)}${/* show currency if available */ ''} , totalFeesConverted=${(rl._sumFeesConverted).toFixed(2)}${currencyType}`);
            } catch (e) { /* ignore */ }

            // accumulate into work-item totals
            wi_sumHours += rl._sumHours || 0;
            wi_sumFeesSource += rl._sumFeesSource || 0;
            wi_sumFeesConverted += rl._sumFeesConverted || 0;

        } catch (e) {
            console.warn('Error printing resourceLink', e, rl);
        }
    });

    // Print work-item level totals across all resource links
    try {
        console.log(`WorkItem totals: totalHours=${wi_sumHours.toFixed(2)}, totalFeesSource=${wi_sumFeesSource.toFixed(2)}, totalFeesConverted=${wi_sumFeesConverted.toFixed(2)}${currencyType}`);
    } catch (e) { /* ignore */ }

    console.log(`--- End of task sample for ${taskExternalID} ---`);
}

// Expose for console convenience
window.printTaskRemainingForecastSample = printTaskRemainingForecastSample;

// Debug helper: print the UserRecord entries (authoritative UI values) for users on a specific task
// Usage from console: printTaskUserRecordSample('/Task/12345')
function printTaskUserRecordSample(taskExternalID) {
    if (!regularResourceLinkManager) {
        console.log('regularResourceLinkManager not initialized');
        return;
    }

    if (!taskExternalID) {
        console.log('Please provide taskExternalID, e.g. printTaskUserRecordSample("/Task/123")');
        return;
    }

    console.log(`--- Task UserRecord Sample for ${taskExternalID} ---`);

    // Find all resource links that belong to the task
    const links = regularResourceLinkManager.links.filter(l => l.workItemExternalID === taskExternalID);
    if (!links || links.length === 0) {
        console.log('  (no regular resource links found for this task)');
    }

    links.forEach((link, idx) => {
        try {
            const userKey = '/User/' + link.resourceExternalID;
            const userRec = dataModel.get(userKey);
            console.log(`  Link ${idx + 1}: resourceExternalID=${link.resourceExternalID}, displayName=${link.displayName}, resourceLinkExternalID=${link.externalid}`);
            if (userRec) {
                console.log(`    -> Found UserRecord: userKey=${userKey}, displayName=${userRec.userDisplayName}, jobTitle=${userRec.userJobTitle}`);
                // Current month forecast until EOM (days)
                const currentForecastUntilEOM = userRec.forecastTaskAssignmentUntilEOM || userRec.forecastProjectAssignmentUntilEOM || 0;
                // Determine authoritative total: Forecast Until EOM + all future months from next month until end
                const nextMonthInfo = getNextMonthYear(new Date(userRec.thisMonday || thisMonday));
                let futureField = (laborBudget === 'Task Assignment') ? 'taskAssignment' : 'projectAssignment';
                const futureSumFromUser = userRec.calculateTotalFrom(futureField, nextMonthInfo.year, nextMonthInfo.month) || 0;
                const authoritativeTotalDays = (laborBudget === 'Task Assignment') ? userRec.getForecastEffortBalanceTaskAssignment() : userRec.getForecastEffortBalanceProjectAssignment();

                console.log(`       Forecast Until EOM (days): ${currentForecastUntilEOM}`);
                console.log(`       Future months sum from next month (${nextMonthInfo.year}-${String(nextMonthInfo.month).padStart(2,'0')}) (days): ${futureSumFromUser}`);
                console.log(`       Authoritative total (days) [Forecast Until EOM + future months]: ${authoritativeTotalDays}`);

                // Print monthly records summary (helpful for tracing where future sums come from)
                for (const [k, rec] of userRec.monthlyRecords) {
                    try {
                        // month key is stored as YYYY-MM
                        const parts = String(k).split('-');
                        const yr = Number(parts[0]) || 0;
                        const mon = Number(parts[1]) || 0;

                        // choose the relevant effort field based on laborBudget
                        const effortDays = (laborBudget === 'Task Assignment') ? (rec.taskAssignment || 0) : (rec.projectAssignment || 0);
                        const effortHours = effortDays * HOURS_PER_DAY;

                        // Lookup job-title rate for that month/year
                        const jobRates = jobTitlesRateModel && typeof jobTitlesRateModel.getRates === 'function'
                            ? jobTitlesRateModel.getRates(userRec.userJobTitleExternalID, mon, yr)
                            : { regularRate: { value: 0, currency: '' } };

                        const rateValue = Number(jobRates?.regularRate?.value) || 0;
                        const rateCurrency = jobRates?.regularRate?.currency || '';

                        // Determine exchange rate to project currency for that month/year
                        let exch = 1;
                        try {
                            exch = (currencyType !== 'AUD') ? exchangeTable.getExchangeRateForCurrencyAndMonth(currencyType, mon, yr) : 1;
                        } catch (e) {
                            exch = 1;
                        }
                        // If the rate's currency is not AUD and the conversion above is for project currency,
                        // keep exch=1 when the rate is already in project currency (heuristic same as elsewhere)
                        if (rateCurrency && rateCurrency !== 'AUD' && rateCurrency === currencyType) {
                            exch = 1;
                        }

                        const feesSource = effortHours * rateValue; // fee in rate's currency
                        const feesConverted = convertToProjectCurrency(feesSource, rateCurrency || '', currencyType, exch, mon, yr);

                        console.log(`       month=${k}: projectAssignment=${rec.projectAssignment || 0}, taskAssignment=${rec.taskAssignment || 0}, actualApproved=${rec.actualApproved || 0}` +
                            ` | rate=${rateValue}${rateCurrency ? ' ' + rateCurrency : ''}, exchange=${exch}, feesSource=${feesSource.toFixed(2)}${rateCurrency || ''}, feesConverted=${feesConverted.toFixed(2)}${currencyType}`);
                    } catch (e) {
                        console.warn('       Error printing monthlyRecords detail', e, k, rec);
                        console.log(`       month=${k}: projectAssignment=${rec.projectAssignment || 0}, taskAssignment=${rec.taskAssignment || 0}, actualApproved=${rec.actualApproved || 0}`);
                    }
                }

                // Now compare with project model if available
                const workItem = projectRemainingForecastFeesModel && projectRemainingForecastFeesModel.getWorkItem(taskExternalID);
                if (workItem) {
                    const resourceLinkRecord = workItem.getResourceLink(link.resourceExternalID);
                    if (resourceLinkRecord) {
                        // Project model current month and future sums (days)
                        let projectCurrentDays = 0;
                        let projectFutureDays = 0;
                        let projectTotalDays = 0;
                        for (const yrRec of resourceLinkRecord.yearMonthlyRecords) {
                            const d = Number(yrRec.assignmentInDays) || 0;
                            // compare by year/month
                            if (yrRec.year === thisYear && yrRec.month === thisMonth) {
                                projectCurrentDays += d;
                            } else {
                                // if later than current month
                                const recDate = new Date(yrRec.year, yrRec.month - 1, 1);
                                const cutoff = new Date(thisYear, thisMonth - 1, 1);
                                if (recDate >= cutoff) {
                                    // include current-month already handled; this will add current again if recDate==cutoff but we already separated
                                    if (!(yrRec.year === thisYear && yrRec.month === thisMonth)) {
                                        projectFutureDays += d;
                                    }
                                }
                            }
                            projectTotalDays += d;
                        }
                        // As saved, Forecast Effort Balance is in hours: getTotalAssignmentInHours
                        const projectTotalHours = resourceLinkRecord.getTotalAssignmentInHours();
                        const projectTotalDaysFromHours = projectTotalHours / HOURS_PER_DAY;

                        console.log(`       Project model -> currentMonthDays=${projectCurrentDays}, futureDays=${projectFutureDays}, totalDays(stored)=${projectTotalDays}, totalHours(calc)=${projectTotalHours}, totalDays(fromHours)=${projectTotalDaysFromHours}`);

                        const deltaDays = projectTotalDaysFromHours - authoritativeTotalDays;
                        const deltaHours = projectTotalHours - (authoritativeTotalDays * HOURS_PER_DAY);
                        console.log(`       Delta (project - authoritative): ${deltaDays.toFixed(3)} days (${deltaHours.toFixed(2)} hours)`);
                    } else {
                        console.log('    -> No ResourceLinkRecord found in project model for this user');
                    }
                } else {
                    console.log('    -> No workItem found in project model for this task');
                }
            } else {
                console.log(`    -> No UserRecord found for userKey=${userKey}`);
            }
        } catch (e) {
            console.warn('  Error printing link/user record', e, link);
        }
    });

    console.log(`--- End of UserRecord sample for ${taskExternalID} ---`);
}

// Expose authoritative UserRecord printer
window.printTaskUserRecordSample = printTaskUserRecordSample;

//for git