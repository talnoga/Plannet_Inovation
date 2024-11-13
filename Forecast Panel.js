debugger;

var $ = jQuery.noConflict();

var maxDate, minDate; // will hold the maximum start date and end date of the grid to be used in iterations
NUM_OF_DATA_COLUMNS = 2;
NUM_OF_COLUMNS_AFTER_DATA = 3;
var monthNameList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

var data = API.Context.getData();
var fromStartDate = data.projectStartDate;
var toEndDate = data.projectDueDate;
var laborBudget = data.laborBudget;
var workItemExternalID = data.currentProject.ExternalID;
var WorkItemtype= data.WorkItemtype;
var dataModel = new Map();
const HOURS_PER_DAY= data.hoursPerDay;
const thisMonday = getThisMondayOrFirstWorkingDay();
const lastDayOfThisMondayMonth = getLastDayOfThisMondayMonth(new Date(thisMonday));

class UserRecord {
    constructor(userKey, userDisplayName, vThisMonday) {
        this.userKey = userKey; // Unique identifier for each user
        this.userDisplayName = userDisplayName;
        this.monthlyRecords = new Map(); // Map to hold monthly data records
        this.firstMonthYear = null;
        this.lastMonthYear = null;
        this.thisMonday = vThisMonday; // Date for "This Monday"
        
        // Forecast effort balance variables
        this.forecastTaskAssignmentUntilEOM = 0;
        this.forecastProjectAssignmentUntilEOM = 0;
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
                projectAssignment, 
                taskAssignment, 
                actualApproved 
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

    //will return the forecast Task Assignment Until End of Month plus all the forecast from next month until the end period 
    getForecastEffortBalanceTaskAssignment(){
        const nextMonthInfo = getNextMonthYear(new Date(this.thisMonday));
        const totalTaskAssignmentUntilEnd = this.calculateTotalFrom("taskAssignment", nextMonthInfo.year, nextMonthInfo.month);
        return this.forecastTaskAssignmentUntilEOM+totalTaskAssignmentUntilEnd;
    }

    //will return the forecast Project Assignment Until End of Month plus all the forecast from next month until the end period
    getForecastEffortBalanceProjectAssignment() {
        const nextMonthInfo = getNextMonthYear(new Date(this.thisMonday));
        const totalProjectAssignmentUntilEnd = this.calculateTotalFrom("projectAssignment", nextMonthInfo.year, nextMonthInfo.month);
        return this.forecastProjectAssignmentUntilEOM +totalProjectAssignmentUntilEnd;
    }
}



$(function () {
    var yearsRow, tdCell, roleCell;    yearsRow = $("#years-row");


    try {

        var numOfMonths = iterateOnMonthsRange(true);//first call on init, need to add the TD's as pre append

        //now add back the 3 headers removed Work(D), Actual Regular Effort (D),Forecast Effort Balance (D)
        tdCell = $("<td rowspan='" + 4 + "'>Work(D)</td>");
        tdCell.addClass("year-seprator");
        yearsRow.append(tdCell);
        tdCell = $("<td rowspan='" + 4 + "'>Actual Regular Effort (D)</td>");
        yearsRow.append(tdCell);
        tdCell = $("<td rowspan='" + 4 + "'>Forecast Effort Balance (D)</td>");
        yearsRow.append(tdCell);
        
        yearsRow.append(tdCell);
//        if (monthNameList[datePickerStart.getMonth()] == "Jan") {
   //         roleCell.addClass("year-right-seprator");
   //     } else {
   //         roleCell.removeClass("year-right-seprator");
   //     }

        console.log("Current Project: " + data.currentProject.SYSID);						
        //load data
        executeQuery(numOfMonths);
    } catch (err) {
        console.log(err);
    }

});


function executeQuery(nomOfMonths){
	var resultQry = new Array();
    	
	API.Utils.beginLoading();
		
    const query = QueryBuilder(WorkItemtype === "Project" ? 1 : 3);
	
	//load data with pagings 
    queryMore(0, resultQry, buildUserDataModel, query,nomOfMonths);
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



/*
Will be called for cleaning the TD's of table headers
*/
function removeTRTDs(fromSelector) {
    var node;
    $(fromSelector).find("td").each(function () {
        node = this;
        $(this).remove();
    });
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
        tdCell = $("<td>For.</td>")

        if (monthNameList[date.getMonth()] == "Jan") {
            tdCell.addClass("year-seprator");
        }
        dataRow.append(tdCell);
        tdCell = $("<td>Act.</td>")
        dataRow.append(tdCell);

        date.setMonth(date.getMonth() + 1);
        j += 1;
        k += 1;
    }
    //console.log("Total Months: " + j);
    return j;
    //return resultList;
}


function QueryBuilder(caseNumber) {
    var qrySql = "";
    const pagingSuffix = " limit 5000 offset ";
    switch (caseNumber) {
        case 1://assignment from project level
            return "Select WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,User.DisplayName,Date,User.Name,User.JobTitle.Name,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseMonthly where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and (Project in(Select SYSID from Project where ExternalID='"+workItemExternalID+"'))" +pagingSuffix;
        case 2://daily forcast from this Monday until end of month from project level 
            return "Select WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.Name,User.DisplayName,User.JobTitle.Name,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseDaily where (Date>='"+thisMonday+"' and Date<='"+lastDayOfThisMondayMonth+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and (Project in(Select SYSID from Project where ExternalID='"+workItemExternalID+"'))" +pagingSuffix ;       
        case 3://assignment from task level
            return "Select WorkITem.Name,WorkItem.SysID,WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.Name,User.DisplayName,User.JobTitle.Name,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseMonthly where (Date>='"+fromStartDate+"' and Date<='"+toEndDate+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and ( WorkItem ='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"' or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')) or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')))))"+pagingSuffix;
        case 4: //daily forcast from this Monday until end of month from task level 
            return "Select WorkITem.Name,WorkItem.SysID,WorkITem,EntityType,WorkITem.Project.SYSID,WorkITem.Project.Name,Date,User.Name,User.DisplayName,User.JobTitle.Name,ProjectAssignment,Work,ActualApproved,ActualPending from RLTimePhaseDaily where (Date>='"+thisMonday+"' and Date<='"+lastDayOfThisMondayMonth+"') and (Work>'0h' or ActualPending>'0h' or ProjectAssignment>'0h') and ( WorkItem ='/Task/"+workItemExternalID+"' or WorkItem in(Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"' or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')) or child in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent in (Select child from RealWorkItemHierarchyLink where parent='/Task/"+workItemExternalID+"')))))" +pagingSuffix;  
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
	for (var [key, value] of dataModel) {
      //console.log(key + ' = ' + value);
	  	
	  // add the role	
	  row = $('<tr>');
	  cell = $("<td>"+value.userDisplayName+"</td>");
	  cell.addClass("roleCell");
	  
	  
	  row.append(cell);
	  
      //value.calcAllsummeries();//calcualte summaries on record before iterating on months to draw the data
	  
	  /*
	    iterate on all months in range/ number of columns found		
		*/
	  
	  for (var j = 0; j <((numOfMonths*NUM_OF_DATA_COLUMNS )+NUM_OF_COLUMNS_AFTER_DATA); j++) {
		  
		yYear   = date.getFullYear();
		mMonth  = date.getMonth() + 1;
		recKey = yYear+"-"+mMonth;
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
			cell = $("<td periodKey='"+recKey+"-"+collType+"' cellVal='"+dataToSet+"'>"+dataToSet+"</td>");
			
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

function buildDataModel(result, numOfMonths) {
    
    // Iterate over each record in the results to build the data model
    for (let i = 0; i < result.length; i++) {
        const capacityRecord = result[i];
        let period, forecast,taskAssignment, actualApproved, actualPending, periodYear, periodMonth, userDisplayName, userId;
        
        // Determine the user
        if (capacityRecord.User) {
            userId = capacityRecord.User.id;
            userDisplayName = capacityRecord.User.DisplayName;
        } else {
            userId = "No User";
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
            userRecord = new UserRecord(userId,userDisplayName,thisMonday);
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
        let forecast, taskAssignment, userDisplayName, userId;
        
        // Determine the user
        if (capacityRecord.User) {
            userId = capacityRecord.User.id;
            userDisplayName = capacityRecord.User.DisplayName;
        } else {
            userId = "No User";
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
            userRecord = new UserRecord(userId, userDisplayName, thisMonday);
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
   //now that the the model is full call to draw it  
   drawData(result, numOfMonths);
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
			collType = "FOR";//will hold the key column type for totals identification
		}  else {					
			collType  = "ACT";
	    }
		
		columnKey = recKey + "-"+ collType;
		
		if(j<(numOfMonths*NUM_OF_DATA_COLUMNS )){
			totVal = calculateColumnSummary(columnKey);
		}else {
			switch (j){
						case numOfDataCols:
							  recKey = "ETC";
							break;
						case numOfDataCols+1:
							  recKey = "EAC";
							break;
						case numOfDataCols+2:
							recKey = "FTE";
							break;
						case numOfDataCols+3:
							recKey = "MD";
							break;
						case numOfDataCols+4:
							recKey = "Cost";
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
