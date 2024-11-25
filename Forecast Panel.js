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
var laborBudget = data.laborBudget;
var workItemExternalID = data.currentProject.ExternalID;
var projectRateCard= data.currentProject.RateCard.ExternalID;
var currencyType= data.currentProject.RevenueCurrencyType.name;
var WorkItemtype= data.WorkItemtype;
var dataModel = new Map();
var selectedForecastType;
//will hold the currency exchange table
var exchangeTable;
//will hold the rates table per job title of the project, based on the project rate card
var jobTitlesRateModel;
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


class UserRecord {
    constructor(userKey, userDisplayName, vThisMonday,userJobTitle,userJobTitleExternalID) {
        this.userKey = userKey; // Unique identifier for each user
        this.userDisplayName = userDisplayName;
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
        let JobTitlerates = jobTitlesRateModel.getRates(this.userJobTitleExternalID, thisMonth, thisYear);
        let projAssignmentUtliEOM=this.forecastProjectAssignmentUntilEOM;
        let retVal = projAssignmentUtliEOM*JobTitlerates.regularRate.value; 
        return retVal;
    }

    // will get this month and year job title rate and the effort left until the end of this month and return the fees
    getRemainingForecastFeesTaskAssignmentUntilEOM(){
        let JobTitlerates = jobTitlesRateModel.getRates(this.userJobTitleExternalID, thisMonth, thisYear);
        let taskAssignmentUtliEOM=this.forecastTaskAssignmentUntilEOM;
        let retVal = taskAssignmentUtliEOM*JobTitlerates.regularRate.value; 
        return retVal;
    }

    // Calculate total Remaining Forecast Fees for a field from a specific year and month to the latest month in records
    //take the rate of the job title per month and year and add to the calculation
    calculateTotalRemainingForecastFeesFrom(field, startYear, startMonth) {
        let total = 0;
        for (const record of this.monthlyRecords.values()) {
            if ((record.year > startYear) || 
                (record.year === startYear && record.month >= startMonth)) {
                let JobTitlerates = jobTitlesRateModel.getRates(this.userJobTitleExternalID, record.month, record.year);   
                total += record[field]*JobTitlerates.regularRate.value || 0;
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

$(function () {
    var yearsRow, tdCell, roleCell;

    exchangeTable = new CurrencyExchange();//will hoold the exchange rates
    
    jobTitlesRateModel = new RateModel();//will hold the rates per job title based on the project rate card
    
    yearsRow = $("#years-row");

    try {

        selectedForecastType= getSelectedForecastType(); 

        console.log("Current Project: " + data.currentProject.SYSID);		
        var forecastType = document.getElementById('forecastType');
        forecastType.addEventListener('change', function(event) {
            forecastTypeSwitch(event);
        });				

        numOfMonths = iterateOnMonthsRange(true);//first call on init, need to add the TD's as pre append
        
        const headers = FORECST_TOTLAS_HEADERS[selectedForecastType] || ["Unknown", "Unknown","Unknown"];

        //now add back the 3 headers removed Work(D), Actual Regular Effort (D),Forecast Effort Balance (D)
        tdCell = $("<td rowspan='" + 4 + "'>"+headers[0]+"</td>");
        tdCell.addClass("year-seprator");
        yearsRow.append(tdCell);
        tdCell = $("<td rowspan='" + 4 + "'>"+headers[1]+"</td>");
        yearsRow.append(tdCell);
        tdCell = $("<td rowspan='" + 4 + "'>"+headers[2]+"</td>");
        yearsRow.append(tdCell);
        
        
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

    // Get the number of years to calculate if we need to remove or add a cell from the end based on the selected forecast type
    const numOfYears = getYearsBetweenDates()+1;//it's numb er of years plus the left resource cell

    // Add cells based on the selected forecast type
    // Ensure that the row has the correct number of cells (3 for Efforts, 4 for Financials)
    const currentNumOfCells = yearsRow.children("td").length;

    // If Financials is selected and we need to add a new cell
    if (selectedForecastType === FORECAST_TYPES.FINANCIALS && currentNumOfCells < numOfYears + 4) {
        const tdCell = $("<td rowspan='4'>" + headers[3] + "</td>");
        yearsRow.append(tdCell);
    }
    // If Efforts is selected and we need to remove the last cell
    else if (selectedForecastType === FORECAST_TYPES.EFFORTS && currentNumOfCells > numOfYears + 3) {
        yearsRow.children("td").last().remove();
    }

    // Update the text of existing cells starting after the numOfYears count
    yearsRow.children("td").each(function (index) {
        // Update only the cells starting after the numOfYears index
        if (index >= numOfYears) {
            // Make sure the index doesn't go beyond the length of the headers array
            if (index - numOfYears < headers.length) {
                $(this).text(headers[index - numOfYears]);
            }
        }
    });
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
		
    const query = QueryBuilder(WorkItemtype === "Project" ? 5 : 0);
	
	//load data with pagings 
    queryMore(0, resultQry, buidFinancialDataModel, query,nomOfMonths);
}

/*
 will be called for buiding the data model of financials
 */
function buidFinancialDataModel(result, numOfMonths){
    for (let i = 0; i < result.length; i++) {
        const financeRecord = result[i];
        let period, periodYear, periodMonth,userDisplayName,userJobTitle,userJobTitleEId,userId,PlannedBudget,ActualCost,C_D365SalesPriceAUD,C_MarkupRevenue,C_D365SalesPrice,C_MarkupRevVariance,exchangeRate;
        
        // Determine the user
        if (financeRecord.RelatedLink.LaborResource) {
            userId = financeRecord.RelatedLink.LaborResource.id;
            userDisplayName = financeRecord.RelatedLink.LaborResource.DisplayName;
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
         try { 
            PlannedBudget = Number(financeRecord.PlannedBudget?.value)|| 0;
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
            userRecord = new UserRecord(userId,userDisplayName,null,userJobTitle,userJobTitleEId);
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
   
    const query = QueryBuilder(WorkItemtype === "Project" ? 6 : 0);
	
	//load data with pagings 
    queryMore(0, resultQry, addActualBookedToDataModel, query,nomOfMonths);
}


//add the actual booked from timesheets to the data model 
function addActualBookedToDataModel(result, numOfMonths){
    for (let i = 0; i < result.length; i++) {
        const timeSheetRecord = result[i];
        let period, periodYear, periodMonth,userDisplayName,userId,C_D365PriceofItem,userJobTitle,userJobTitleEId;
        
        // Determine the user
        if (timeSheetRecord.ReportedBy) {
            userId = timeSheetRecord.ReportedBy.id;
            userDisplayName = timeSheetRecord.ReportedBy.DisplayName;
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
            userRecord = new UserRecord(userId,userDisplayName,null,userJobTitle,userJobTitleEId);
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
            tdCell.css('background', '#999900');
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
            return "Select WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,User.DisplayName,Date,User.Name,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseMonthly where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and (Project in(Select SYSID from Project where ExternalID='"+workItemExternalID+"'))" +pagingSuffix;
        case 2://daily forcast from this Monday until end of month from project level 
            return "Select WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.Name,User.DisplayName,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseDaily where (Date>='"+thisMonday+"' and Date<='"+lastDayOfThisMondayMonth+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and (Project in(Select SYSID from Project where ExternalID='"+workItemExternalID+"'))" +pagingSuffix ;       
        case 3://assignment from task level
            return "Select WorkITem.Name,WorkItem.SysID,WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.Name,User.DisplayName,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseMonthly where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and ( WorkItem ='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"' or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')) or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')))))"+pagingSuffix;
        case 4: //daily forcast from this Monday until end of month from task level 
            return "Select WorkITem.Name,WorkItem.SysID,WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.Name,User.DisplayName,User.JobTitle.Name,User.JobTitle.externalid,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseDaily where (Date>='"+thisMonday+"' and Date<='"+lastDayOfThisMondayMonth+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and ( WorkItem ='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"' or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')) or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')))))" +pagingSuffix;  
        case 5://get financials for project level aggregated
            return "Select EntityType,RelatedLink.WorkItem.Project.SYSID,RelatedLink.WorkItem.Project.Name,RelatedLink.LaborResource.DisplayName,RelatedLink.LaborResource.Name,RelatedLink.LaborResource.JobTitle.Name,RelatedLink.LaborResource.JobTitle.externalid,RelatedLink.LaborResource.Name,Date,RelatedLink.DefaultCurrency,RelatedLink.CurrencyExchangeDate,PlannedBudget,ActualCost,C_D365SalesPriceAUD,C_MarkupRevenue,C_D365SalesPrice,C_MarkupRevVariance,Aggregated,ActualRevenue,RelatedLink from ResourceTimePhase where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and RelatedLink in(select ExternalID from ResourceLinkFinancial where WorkItem ='/Project/"+workItemExternalID+"' and EntityType='LaborResourceLinkAggregated')" +pagingSuffix;  
        case 6://get project level actual booed values
            return "Select ReportedBy.DisplayName,ReportedBy.Name,ReportedBy.JobTitle.Name,ReportedBy.JobTitle.externalid,ReportedDate,C_D365PriceofItem,C_InvoiceStatus from Timesheet where ReportedDate>='"+fromStartDate+"' and ReportedDate<='"+toEndDate+"' and C_InvoiceStatus not in('Adjusted','Nonchargeable') and Project='/Project/"+workItemExternalID+"'"+pagingSuffix;
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
function drawData(result, numOfMonths){
    //clear table first
    removeTBodyRows();
   
    //show or hide the table based on the data
	if(dataModel.size>0){
		$("#data-table").show();				
	}else {
		$("#data-table").hide();		
	}
	
	tbodyTbl = $("#data-table tbody");
	
	//adjust start date to begining of month 
    var date = new Date(fromStartDate);
	
	/*
	  now iterate on the model and add to the table
	  each record represents a role and contains the role month
	  on each record we should
	    1. Get the user
		2. Iterate on the data per month, fill in 0 in the missing months
		3. Add thew record last few columns
	 */	
	var numOfDataCols = (numOfMonths*NUM_OF_DATA_COLUMNS);
	var jobTitleExternalID;

    for (var [key, value] of dataModel) {
      //console.log(key + ' = ' + value);
	  	
	  // add the role	
	  row = $('<tr>');
	  cell = $("<td title='"+value.userJobTitle+"'>"+value.userDisplayName+"</td>");
	  cell.addClass("roleCell");
	  
	  jobTitleExternalID=value.userJobTitleExternalID;

	  row.append(cell);
	  
      //value.calcAllsummeries();//calcualte summaries on record before iterating on months to draw the data
	  
	  /*
	    iterate on all months in range/ number of columns found		
		*/
	  
	  for (var j = 0; j <((numOfMonths*NUM_OF_DATA_COLUMNS )+NUM_OF_COLUMNS_AFTER_DATA); j++) {
		  
		yYear   = date.getFullYear();
		mMonth  = date.getMonth() + 1;
		recKey = yYear+"-"+mMonth;

        let JobTitlerates = jobTitlesRateModel.getRates(jobTitleExternalID, mMonth, yYear);
        let rateString = 'JobTitle:'+jobTitleExternalID + `, Regular Rate: ${JobTitlerates.regularRate.value} ${JobTitlerates.regularRate.currency}, `;
            rateString += `Overtime Rate: ${JobTitlerates.overtimeRate.value} ${JobTitlerates.overtimeRate.currency}`;

		if (j% 2===0){				
			collType = "FOR";//will hold the key column type for totals identification
		}  else {					
			collType  = "ACT";
	    }
		
		
		recData = value.getMonthlyRecord(yYear,mMonth);
		
		//if data was found and we still runing on the months
		if(recData && j<(numOfMonths*NUM_OF_DATA_COLUMNS )){
			//console.log("Role: " + key + ", Period: " + recKey + " For.= "+recData.forecst+", Act.= " + recData.actual);
			//if data was found for month, if J is odd we need to take forecast, otherwise actual
			try{
				if (j% 2===0){
                    if(laborBudget=="Task Assignment"){
                        dataToSet = Number(recData.taskAssignment).toFixed(1);		
                    }else{
                        dataToSet = Number(recData.projectAssignment).toFixed(1);		
                    }
					
				}  else {
					dataToSet = Number(recData.actualApproved).toFixed(1);					
				}
			}catch (err){
				dataToSet = 0;
			}				
			//save the period key tag on each TD cell for sum calaucltion of columns
			cell = $("<td periodKey='"+recKey+"-"+collType+"' cellVal='"+dataToSet+"' title='"+rateString+"'>"+dataToSet+"</td>");
			
			if (!(j% 2===0)){
				cell.css('background', '#f0f5f5');
			}		
			
			if (mMonth==1 && (j% 2===0)){//on Jan add the year seprator
			  cell.addClass("year-seprator");
			}  
			row.append(cell);
			
		} else {
			
          //check to see if we ended the data columns by months and now we are at ETC, EAC etc.
          if(j>=(numOfMonths*NUM_OF_DATA_COLUMNS)){			  
			   switch (j){
						case numOfDataCols:
                            if(laborBudget=="Task Assignment"){
							  recKey = "taskAssignment";
                            }else{
                              recKey = "projectAssignment";
                            }
							  dataToSet = Number(value.calculateTotal(recKey)).toFixed(2);                              
							break;
						case numOfDataCols+1:
							  recKey = "actualApproved";
							  dataToSet = Number(value.calculateTotal(recKey)).toFixed(2);
							break;
						case numOfDataCols+2:
                            recKey = "Forecast_Effort_Balance";
                            if(laborBudget=="Task Assignment"){
                                dataToSet = Number(value.getForecastEffortBalanceTaskAssignment()).toFixed(1);		
                            }else{
                                dataToSet = Number(value.getForecastEffortBalanceProjectAssignment()).toFixed(1);		
                            }							
							break;						
						default:
							recKey = "";
					}                        
			  //set precision of cost to zero, 2 for all the others		
			  if (j== (numOfDataCols+4)){
				numOrecision = 0;  
			  }else{
				numOrecision =2;
			  }
			   
			  cell = $("<td periodKey='"+recKey+"' cellVal='"+dataToSet+"'>"+Number(dataToSet).formatMoney(numOrecision, ',', '.')+"</td>");  
			  if(j==numOfDataCols){
				  cell.addClass("year-seprator");
			  }
			  cell.css('background', '#ffffe6');			  
		  } else {//no data was found just add an empty cell
			  cell = $("<td periodKey='"+recKey+"-"+collType+"' cellVal='"+0+"'>"+"&nbsp;"+"</td>");  
			  if (mMonth==1 && (j% 2===0)){//on Jan add the year seprator
			    cell.addClass("year-seprator");			  
			 } 
             //on acrual add the background 
			  if (!(j% 2===0)){
				cell.css('background', '#f0f5f5');
			  }					 
		  }			  	
		  
		  //if (mMonth==1 && (j% 2===0)){//on Jan add the year seprator
			//  cell.addClass("year-seprator");
			//}  
	      row.append(cell);	
		}	
		//move month ahead on evry second round when J is odd
		if(!(j% 2===0)){
		  date.setMonth(date.getMonth() + 1);//move the month 1 ahead		  
		}
		
	  }		  
	  
	  tbodyTbl.append(row);
	  date = new Date(fromStartDate);//reset the date to start date
    }
    //call for adding the total row
	addTotalRow(tbodyTbl,numOfMonths);
    API.Utils.endLoading();  
}

//draw trhe financial model
function drawFinancialData(numOfMonths){
    var exchangeRateVal,titleTXT;
    //clear table first
    removeTBodyRows();
   
    //show or hide the table based on the data
	if(dataModel.size>0){
		$("#data-table").show();				
	}else {
		$("#data-table").hide();		
	}
	
	tbodyTbl = $("#data-table tbody");
	
	//adjust start date to begining of month 
    var date = new Date(fromStartDate);
    var jobTitleExternalID;

	/*
	  now iterate on the model and add to the table
	  each record represents a role and contains the role month
	  on each record we should
	    1. Get the user
		2. Iterate on the data per month, fill in 0 in the missing months
		3. Add thew record last few columns
	 */	
	var numOfDataCols = (numOfMonths*NUM_OF_DATA_COLUMNS);
	for (var [key, value] of dataModel) {
      //console.log(key + ' = ' + value);
	  // add the role	
	  row = $('<tr>');
	  cell = $("<td title='"+value.userJobTitle+"'>"+value.userDisplayName+"</td>");
	  cell.addClass("roleCell");
	  
      let EACFees=0;
      let RemainingForecastFees=0;
      let ActualBookedFees=0; 

      jobTitleExternalID=value.userJobTitleExternalID;
	  
	  row.append(cell);
	  
      //value.calcAllsummeries();//calcualte summaries on record before iterating on months to draw the data
	  
	  /*
	    iterate on all months in range/ number of columns found		
		*/
	  
	  for (var j = 0; j <((numOfMonths*NUM_OF_DATA_COLUMNS )+NUM_OF_COLUMNS_AFTER_DATA_FINANCE); j++) {
		  
		yYear   = date.getFullYear();
		mMonth  = date.getMonth() + 1;
		recKey = yYear+"-"+mMonth;
		if (j% 2===0){				
			collType = "BUD";//will hold the key column type for totals identification
		}  else {					
			collType  = "ACT";
	    }
		
        //get job title rates fot the hint
		let JobTitlerates = jobTitlesRateModel.getRates(jobTitleExternalID, mMonth, yYear);
        let rateString = 'JobTitle:'+jobTitleExternalID + `, Regular Rate: ${JobTitlerates.regularRate.value} ${JobTitlerates.regularRate.currency}, `;
            rateString += `Overtime Rate: ${JobTitlerates.overtimeRate.value} ${JobTitlerates.overtimeRate.currency}`;
		
            recData = value.getMonthlyRecord(yYear,mMonth);
		
		//if data was found and we still runing on the months
		if(recData && j<(numOfMonths*NUM_OF_DATA_COLUMNS )){
			//console.log("Role: " + key + ", Period: " + recKey + " For.= "+recData.forecst+", Act.= " + recData.actual);
			//if data was found for month, if J is odd we need to take budget, otherwise actual
			try{
				if(j% 2===0){                    
                    exchangeRateVal = recData.exchangeRate;
                    dataToSet = Number(convertValueUsingExchangeRate(recData.budget,exchangeRateVal));
                    titleTXT = "Exchange Rate: "+Number(exchangeRateVal).toFixed(4) +", Value in AUD: "+Number(recData.budget).toFixed(2); 				
				}  else {
                    
					//dataToSet = Number(recData.actualApproved).toFixed(1);
					dataToSet = Number(recData.actualBooked);	
                    titleTXT="";			
				}
			}catch (err){
				dataToSet = 0;
			}				
            titleTXT+="| " + rateString;
			//save the period key tag on each TD cell for sum calaucltion of columns
			cell = $("<td periodKey='"+recKey+"-"+collType+"' cellVal='"+dataToSet+"' title='"+titleTXT+"'>"+dataToSet.formatMoney(0, ',', '.')+"</td>");
			
			if (!(j% 2===0)){
				cell.css('background', '#f0f5f5');
			}		
			
			if (mMonth==1 && (j% 2===0)){//on Jan add the year seprator
			  cell.addClass("year-seprator");
			}  
			row.append(cell);
			
		} else {
			
          //check to see if we ended the data columns by months and now we are at ETC, EAC etc.
          if(j>=(numOfMonths*NUM_OF_DATA_COLUMNS)){			  
			   switch (j){
						case numOfDataCols:
                            recKey = "budget";
                            dataToSet = Number(value.calculateTotalWithExchangeRate(recKey));                              
							break;
						case numOfDataCols+1:
							  recKey = "actualBooked";
							  dataToSet = Number(value.calculateTotal(recKey));  
                              ActualBookedFees=dataToSet; 
							break;
						case numOfDataCols+2:
                              recKey = "Remaining_Forecast_Fees";
                              if(laborBudget=="Task Assignment"){
                                dataToSet = Number(value.getRemainingForecastFeesTaskAssignment());		
                               }else{
                                dataToSet = Number(value.getRemainingForecastFeesProjectAssignment());		
                               }	
                               RemainingForecastFees=dataToSet;											
							break;			
						case numOfDataCols+3:
                              recKey = "EAC_Fees";
                              EACFees= RemainingForecastFees+ActualBookedFees;
							  dataToSet = Number(EACFees);  						
							break;										
						default:
							recKey = "";
					}                        
			  //set precision of cost to zero, 2 for all the others		
			  if (j== (numOfDataCols+4)){
				numOrecision = 0;  
			  }else{
				numOrecision =2;
			  }
			   
			  cell = $("<td periodKey='"+recKey+"' cellVal='"+dataToSet+"'>"+Number(dataToSet).formatMoney(numOrecision, ',', '.')+"</td>");  
			  if(j==numOfDataCols){
				  cell.addClass("year-seprator");
			  }
			  cell.css('background', '#ffffe6');			  
		  } else {//no data was found just add an empty cell
			  cell = $("<td periodKey='"+recKey+"-"+collType+"' cellVal='"+0+"'>"+"&nbsp;"+"</td>");  
			  if (mMonth==1 && (j% 2===0)){//on Jan add the year seprator
			    cell.addClass("year-seprator");			  
			 } 
             //on acrual add the background 
			  if (!(j% 2===0)){
				cell.css('background', '#f0f5f5');
			  }					 
		  }			  	
		  
		  //if (mMonth==1 && (j% 2===0)){//on Jan add the year seprator
			//  cell.addClass("year-seprator");
			//}  
	      row.append(cell);	
		}	
		//move month ahead on evry second round when J is odd
		if(!(j% 2===0)){
		  date.setMonth(date.getMonth() + 1);//move the month 1 ahead		  
		}
		
	  }		  
	  
	  tbodyTbl.append(row);
	  date = new Date(fromStartDate);//reset the date to start date
    }
    //call for adding the total row
	addTotalRow(tbodyTbl,numOfMonths);
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
    jobTitlesRateModel.finalizeRecords(); 
   // jobTitlesRateModel.print();
    // Now that the model is full, call to draw it  
    drawData(null, numOfMonths);
}


function buildDataModel(result, numOfMonths) {
    
    // Iterate over each record in the results to build the data model
    for (let i = 0; i < result.length; i++) {
        const capacityRecord = result[i];
        let period, forecast,taskAssignment, actualApproved, actualPending, periodYear, periodMonth, userDisplayName, userId,userJobTitle,userJobTitleEId;
        
        // Determine the user
        if (capacityRecord.User) {
            userId = capacityRecord.User.id;
            userDisplayName = capacityRecord.User.DisplayName;
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
            userRecord = new UserRecord(userId,userDisplayName,thisMonday,userJobTitle,userJobTitleEId);
            dataModel.set(userId, userRecord);
        }
        
        if(laborBudget=="Task Assignment"){
            //addOrUpdateMonthlyRecord(year, month, projectAssignment = 0, taskAssignment = 0, actualApproved = 0) 
             // Update the user's monthly record with the new data
           userRecord.addOrUpdateMonthlyRecord(periodYear, periodMonth,forecast, taskAssignment, actualApproved + actualPending);
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
        let forecast, taskAssignment, userDisplayName, userId, userJobTitle,userJobTitleEId;
        
        // Determine the user
        if (capacityRecord.User) {
            userId = capacityRecord.User.id;
            userDisplayName = capacityRecord.User.DisplayName;
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
            userRecord = new UserRecord(userId, userDisplayName, thisMonday,userJobTitle,userJobTitleEId);
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

   //load the job title rates
   loadJobTitlesRates(numOfMonths); 
   
}

//will get the number of years between the start and end dates for calcualting the last cell int he years-raw
function getYearsBetweenDates() {
    // Convert both dates to Date objects
    var startDate = new Date(fromStartDate);
    var endDate = new Date(toEndDate);

    // Calculate the difference in years
    var yearsDifference = endDate.getFullYear() - startDate.getFullYear();

    // Adjust for the months and days if the end date is before the anniversary of the start date in the end year
    var monthDifference = endDate.getMonth() - startDate.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && endDate.getDate() < startDate.getDate())) {
        yearsDifference--;
    }

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
	 cell = $("<td>Total</td>");
	 row.append(cell);
	 cell.addClass("summaryTotalCell");
	
	for (var j = 0; j <((numOfMonths*NUM_OF_DATA_COLUMNS )+NUM_OF_COLUMNS_AFTER_DATA); j++) {		  
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
		
		if(j<(numOfMonths*NUM_OF_DATA_COLUMNS )){
			totVal = calculateColumnSummary(columnKey);
		}else {
            switch (j){
                case numOfDataCols:
                    if (selectedForecastType === FORECAST_TYPES.FINANCIALS){
                        recKey ="budget";
                    }else {
                        if(laborBudget=="Task Assignment"){
                          recKey = "taskAssignment";
                        }else{
                          recKey = "projectAssignment";
                        }								
                    }							  
                    break;
                case numOfDataCols+1:
                    if (selectedForecastType === FORECAST_TYPES.FINANCIALS){
                        recKey ="actualBooked";
                    }else {
                        recKey = "actualApproved";
                    }	
                    break;
                case numOfDataCols+2:
                    if (selectedForecastType === FORECAST_TYPES.FINANCIALS){
                        recKey ="Remaining_Forecast_Fees";
                    }else {
                        recKey = "Forecast_Effort_Balance";
                    }
                    break;
                case numOfDataCols+3:
                    recKey = "EAC_Fees";
                    break;						
                default:
                    recKey = "";
            }
			totVal = calculateColumnSummary(recKey);	
		}
		
		//in case of cost format money, otherwise number
		if (j==numOfDataCols+4){
		  cell = $("<td>"+ Number(totVal).formatMoney(0, ',', '.') +"</td>");  
		}else {
            if (selectedForecastType === FORECAST_TYPES.FINANCIALS){
                cell = $("<td>"+ totVal.formatMoney(0, ',', '.')  +"</td>");  
            }else {
                cell = $("<td>"+ totVal.toFixed(1) +"</td>");  
            }		  
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
    if (thisMonday.getMonth() < today.getMonth() || thisMonday.getFullYear() < today.getFullYear()) {
        // If so, get the first day of the current month
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // Adjust to the first working day if the 1st is on a weekend
        let firstWorkingDay = new Date(firstDayOfMonth);
        const firstDayOfWeek = firstDayOfMonth.getDay();
        if (firstDayOfWeek === 0) { // Sunday
            firstWorkingDay.setDate(firstDayOfMonth.getDate() + 1); // Move to Monday
        } else if (firstDayOfWeek === 6) { // Saturday
            firstWorkingDay.setDate(firstDayOfMonth.getDate() + 2); // Move to Monday
        }
        
        return firstWorkingDay.toISOString().split('T')[0];
    }

    // Otherwise, return this Monday
    return thisMonday.toISOString().split('T')[0];
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
