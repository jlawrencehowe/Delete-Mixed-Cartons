/**
*@NApiVersion 2.1
*@NScriptType Suitelet
*@author Jacob Howe
*
*   Date: 2022-09-27
*	Title: ADV - SL - DeleteMixCartons.ls
*	Purpose: Suitelet to allow a user to delete Mixed Cartons and the related task records
*   Request: PMA-100
*/


define(['N/https','N/record','N/search','N/https','N/url','/SuiteScripts/oauth', '/SuiteScripts/secret', 'N/runtime', 'N/task', 'N/ui/serverWidget'],
    function(https,record,search, https, url, oauth, secret, runtime, task, serverWidget) {


        function onRequestFxn(context) {
			var script = runtime.getCurrentScript();
            
			var currentuser = runtime.getCurrentUser();
			
			var method = context.request.method;
			
			var suiteletUrl = url.resolveScript({
					scriptId: 'customscript_adv_sl_deletemixedcartons',
					deploymentId: 'customdeploy_adv_sl_deletemixedcartons',
					returnExternalUrl: false
				});
			
			if (method == "POST") {
				
				//Grabs the sscc that was scanned
				var sscc = context.request.parameters.originalSSCC;
				var atpsData = [];
				var pickTaskLines = [];
				var binTransferUpdateInfo = [];
				
				//4 = suspended, 7 = review
				var pickStatus = []
				pickStatus.push("4");
				pickStatus.push("7");
				
				//if it remains -1, then no ATPS record was found
				var taskPickingStatus = '-1';
				
				//Find all ATPS records with the carton scanned in the data field that are in a status of suspended or review
				var taskpickingstateSearchObj = search.create({
					   type: "customrecord_adv_taskpickingstate",
					   filters:
					   [
						  ["custrecord_adv_taskpickingstate_data","contains",sscc], 
						  "AND", 
						  ["custrecord_adv_taskpickingstate_task_rec.custrecord_rfs_picktask_status","anyof",pickStatus]
					   ],
					   columns:
					   [
						  search.createColumn({
							 name: "id",
							 sort: search.Sort.ASC,
							 label: "ID"
						  }),
						  search.createColumn({name: "custrecord_adv_taskpickingstate_data", label: "Data"}),
						  search.createColumn({name: "custrecord_adv_taskpickingstate_line_rec", label: "Task Line ID Rec"}),
						  search.createColumn({name: "custrecord_rfs_picktask_status", join: "custrecord_adv_taskpickingstate_task_rec", label: "Task Line ID Rec"}),
   
					   ]
					});
					var searchResultCount = taskpickingstateSearchObj.runPaged().count;
					if(searchResultCount > 0){
						taskpickingstateSearchObj.run().each(function(result) {
							atpsData.push(JSON.parse(result.getValue({name: "custrecord_adv_taskpickingstate_data"})));
							pickTaskLines.push(result.getValue({name: "custrecord_adv_taskpickingstate_line_rec"}));
							taskPickingStatus = result.getValue({name: "custrecord_rfs_picktask_status", join: "custrecord_adv_taskpickingstate_task_rec"});
							return true;
						});
					}
					
				//create custom filter of pick task lines
				var filterObj = [];
				for(var i = 0; i < pickTaskLines.length; i++){
					
					filterObj.push(["id", "equalto", pickTaskLines[i]]);
					if(i < pickTaskLines.length - 1){
						filterObj.push("OR");
					}
				}
				
				//grab all pick task lines from the ATPS record
				var pickTaskLineSearch = search.create({
				   type: "customrecord_rfs_picktask_line",
				   filters: filterObj,
				   columns:
				   [
					  search.createColumn({
						 name: "internalid",
						 join: "CUSTRECORD_RFS_PICKTASK_TX_LINE",
						 label: "Internal ID"
					  }),
					  search.createColumn({
						 name: "custrecord_rfs_picktask_tx_stage_tx",
						 join: "CUSTRECORD_RFS_PICKTASK_TX_LINE",
						 label: "Staging Bin Transfer"
					  }),
					  search.createColumn({
						 name: "internalid",
					  }),
					  search.createColumn({
						 name: "internalid",
						 join: "CUSTRECORD_ADV_TASKPICKINGSTATE_LINE_REC",
						 label: "Internal ID"
					  }),
					  search.createColumn({
						 name: "custrecord_adv_taskpickingstate_data",
						 join: "CUSTRECORD_ADV_TASKPICKINGSTATE_LINE_REC",
						 label: "Internal ID"
					  })
				   ]
				});
				
				
				
				var binTransactions = [];
				var pickTaskTxIds = [];
				pickTaskLineSearch.run().each(function(result) {
					
						//Bin Transaction record
						var transaction = result.getValue({name: "custrecord_rfs_picktask_tx_stage_tx", join: "CUSTRECORD_RFS_PICKTASK_TX_LINE"});
						var pickTaskTxId = result.getValue({name: "internalid", join: "CUSTRECORD_RFS_PICKTASK_TX_LINE"});
						var pickTaskLineId = result.getValue({name: "internalid"});
						var atpsId = result.getValue({name: "internalid", join: "CUSTRECORD_ADV_TASKPICKINGSTATE_LINE_REC"});
						var atpsData = result.getValue({name: "custrecord_adv_taskpickingstate_data", join: "CUSTRECORD_ADV_TASKPICKINGSTATE_LINE_REC"});
						//If it can't find it, add to the list
						if(binTransactions.indexOf(transaction) == -1){
							binTransactions.push(transaction);
						}
						pickTaskTxIds.push(pickTaskTxId);
						var foundBin = false;
						//Find the corresponding bin transaction, if so add pick task line and atps data using the pick task tx record id as the key
						for(var i = 0; i < binTransferUpdateInfo.length; i++){
							
							if(binTransferUpdateInfo[i].binId == transaction){
							binTransferUpdateInfo[i][pickTaskTxId] = {pickTaskLineId: pickTaskLineId, atpsId: atpsId, atpsData: atpsData}
								foundBin = true;
								break;
							}
							
						}
						//If there is no bin, add that bin to the array
						if(!foundBin){
							var json = {};
							json.binId = transaction;
							json[pickTaskTxId] = {pickTaskLineId: pickTaskLineId, atpsId: atpsId, atpsData: atpsData}
							binTransferUpdateInfo.push(json);
						}
				
						
						return true;
				});
				
				
				var bintransferSearchObj = search.create({
				   type: "bintransfer",
				   filters:
				   [
					  ["type","anyof","BinTrnfr"], 
					  "AND", 
					  ["internalidnumber","equalto",binTransactions], 
					  "AND", 
					  ["inventorydetail.item","noneof","@NONE@"]
				   ],
				   columns:
				   [
					  search.createColumn({
						 name: "internalid",
						 summary: "GROUP",
						 label: "Internal ID"
					  }),
					  search.createColumn({
						 name: "quantity",
						 join: "inventoryDetail",
						 summary: "GROUP",
						 label: "Quantity"
					  }),
					  search.createColumn({
						 name: "item",
						 join: "inventoryDetail",
						 summary: "GROUP",
						 label: "Item"
					  })
				   ]
				});
				
				
				
				
				
				//itemQuantities = total quantity for each item for the bin transfer in question
				//pickTaskTXItemQuantities = total item quantity for a pick task TX record
				//Iterrates through the bin transfer data to verify no data is missing before starting to update/delete records
				for(var i = 0; i < binTransferUpdateInfo.length; i++){
					var binTransfer = binTransferUpdateInfo[i].binId;
					if((!binTransfer || binTransfer == '') && taskPickingStatus != 7){
						throw new Error('A----bin transfer not found----A');
					}
					var itemQuantities = {};
					var itemList = [];
					for (var key in binTransferUpdateInfo[i]) {
						if (binTransferUpdateInfo[i].hasOwnProperty(key) && binTransferUpdateInfo[i][key] != binTransfer) {
							var pickTaskTXItemQuantities = {};
							var jsonParse = JSON.parse(binTransferUpdateInfo[i][key].atpsData);
							//Check if any ATPS data is missing
							if(!jsonParse){
								throw new Error('A----ATPS Data not found----A');
							}
							var atpsId = binTransferUpdateInfo[i][key].atpsId;
							
							//or if the id is missing
							if(!atpsId){
								throw new Error('A----ATPS ID not found----A');
							}
							//log.debug('jsonParse', jsonParse);
							pickTaskTXItemQuantities.pickTaskTxId = key;
							//If it cannot find the pick task tx id
							if(!pickTaskTXItemQuantities.pickTaskTxId){
								throw new Error('A----Pick Task TX Id not found----A');
							}
							
							//Update Pick Task Tx record using pickTaskTXItemQuantities
							var pickTaskFieldLookup = search.lookupFields({
								type: 'customrecord_rfs_picktask_tx',
								id: pickTaskTXItemQuantities.pickTaskTxId,
								columns: ['custrecord_rfs_picktask_tx_quantity']
							});
							
							
							if(!pickTaskFieldLookup.custrecord_rfs_picktask_tx_quantity){
								throw new Error('A----Picktask TX Quantity not found----A');
							}
							
						}
					}
					//If the record is suspended, check bin transfer
					if(taskPickingStatus == 4){
						var binTranRecord = record.load({
							type: 'bintransfer',
							id: binTransfer,
							isDynamic: true,
						});
				
						if(!binTranRecord){
							throw new Error('A----Bin Transfer record not found----A');
						}
					}
					
				}
				
				//Loop through the bin transfer data organizing all the item data with the correct bin transfers, pick task tx records, etc 
				var totalItemQuantitiesPerTransfer = {}
				for(var i = 0; i < binTransferUpdateInfo.length; i++){
					
					var binTransfer = binTransferUpdateInfo[i].binId;
					var itemQuantities = {};
					var itemList = [];
					for (var key in binTransferUpdateInfo[i]) {
						if (binTransferUpdateInfo[i].hasOwnProperty(key) && (taskPickingStatus == 7 || binTransferUpdateInfo[i][key] != binTransfer)) {
							var pickTaskTXItemQuantities = {};
							var jsonParse = JSON.parse(binTransferUpdateInfo[i][key].atpsData);
							var atpsId = binTransferUpdateInfo[i][key].atpsId;
							pickTaskTXItemQuantities.pickTaskTxId = key;
							var newAtpsData = '';
							for(var x = 0; x < jsonParse.length; x++){
								var found = false;
								for(var y = 0; y < itemList.length; y++){
									if(itemList[y] == jsonParse[x].pickdetails.item.name){
										found = true;
										break;
									}
								}
								if(!found){
									itemList.push(jsonParse[x].pickdetails.item.id);
								}
								
								if(jsonParse[x].licenseplatenumber == sscc){
									if(!!itemQuantities[jsonParse[x].pickdetails.item.id]){
										itemQuantities[jsonParse[x].pickdetails.item.id].quantity += jsonParse[x].pickdetails.quantity;
									}
									else{
										itemQuantities[jsonParse[x].pickdetails.item.id] = {quantity: jsonParse[x].pickdetails.quantity, binid: jsonParse[x].pickdetails.binid};
									}
									if(!!pickTaskTXItemQuantities['itemId']){
										pickTaskTXItemQuantities['itemId'].quantity += jsonParse[x].pickdetails.quantity;
									}
									else{
										pickTaskTXItemQuantities['itemId'] = {quantity: jsonParse[x].pickdetails.quantity};
									}
								}
								else{
									
									if(newAtpsData != ''){
										newAtpsData+=','
									}
									newAtpsData += JSON.stringify(jsonParse[x]);
								}
								
							}
							//Update or delete ATPS data field with newAtpsData
							if(newAtpsData == ''){
								log.debug('Delete ATPS: ' + atpsId, ' Delete ATPS');
								//delete ATPS record
								var pickTaskTX = record.delete({
								   type: 'customrecord_adv_taskpickingstate',
								   id: atpsId,
								});
							}
							else{
								log.debug('ATPS ID: ' + atpsId, newAtpsData);
								newAtpsData = '['+ newAtpsData + ']'
								//Update ATPS record
								var id = record.submitFields({
									type: 'customrecord_adv_taskpickingstate',
									id: atpsId,
									values: {
										custrecord_adv_taskpickingstate_data: newAtpsData,
									},
									options: {
										enableSourcing: false,
										ignoreMandatoryFields : true
									}
								});
							}
							//Update or delete Pick Task Tx record using pickTaskTXItemQuantities
							var pickTaskFieldLookup = search.lookupFields({
								type: 'customrecord_rfs_picktask_tx',
								id: pickTaskTXItemQuantities.pickTaskTxId,
								columns: ['custrecord_rfs_picktask_tx_quantity']
							});
							if(pickTaskFieldLookup.custrecord_rfs_picktask_tx_quantity == pickTaskTXItemQuantities['itemId'].quantity){
								log.debug('Delete Pick Task TX', pickTaskTXItemQuantities.pickTaskTxId);
								//delete record
								var pickTaskTX = record.delete({
								   type: 'customrecord_rfs_picktask_tx',
								   id: pickTaskTXItemQuantities.pickTaskTxId,
								});
							}
							else{
								log.debug('Pick Task TX ID: ' + pickTaskTXItemQuantities.pickTaskTxId, pickTaskTXItemQuantities['itemId']);
								//update record
								var id = record.submitFields({
									type: 'customrecord_rfs_picktask_tx',
									id: pickTaskTXItemQuantities.pickTaskTxId,
									values: {
										custrecord_rfs_picktask_tx_quantity: (parseInt(pickTaskFieldLookup.custrecord_rfs_picktask_tx_quantity) - parseInt(pickTaskTXItemQuantities['itemId'].quantity)),
									},
									options: {
										enableSourcing: false,
										ignoreMandatoryFields : true
									}
								});
							}
						}
					}
					
					//Only update or delete bin transfer if the task is suspended
					if(taskPickingStatus == 4){
						//load bin transfer
						var binTranRecord = record.load({
							type: 'bintransfer',
							id: binTransfer,
							isDynamic: true,
						});
						//get total lines
						var inventoryLineCount = binTranRecord.getLineCount({
							"sublistId": "inventory"
						})
						
						var index = 0;
						var emptyLines = 0;
						
						while(index < inventoryLineCount){
						log.debug('index', index);
							
							
							binTranRecord.selectLine({
								"sublistId": "inventory",
								"line": index
							});
							
							var lineItemNum = binTranRecord.getCurrentSublistValue({
									"sublistId": "inventory",
									"fieldId": "item",
							});
							
							//log.debug('lineItemNum', lineItemNum);
							
							if(itemQuantities.hasOwnProperty(lineItemNum)){
								
								var lineItemQuantity = binTranRecord.getCurrentSublistValue({
										"sublistId": "inventory",
										"fieldId": "quantity",
									});
								
								//Check if the update will make the line quantity 0, if so, delete the line and decrement the index
								if(lineItemQuantity - itemQuantities[lineItemNum].quantity == '0.0'){
									binTranRecord.removeLine({
										sublistId: 'inventory',
										line: index,
										ignoreRecalc: true
									});
									index--;
									inventoryLineCount--;
								}
								//Update the bin transfer line
								else{
								
									
									
									var invdetail = binTranRecord.getCurrentSublistSubrecord({
										sublistId: 'inventory',
										fieldId: 'inventorydetail',
									});
									
									
									
									invdetail.selectLine({
										"sublistId": "inventoryassignment",
										"line": 0
									});
									
									

									var binid = invdetail.getCurrentSublistValue({
										sublistId: 'inventoryassignment',
										fieldId: 'binnumber',
									});
									
									log.debug('testBin: ' + itemQuantities[lineItemNum].binid); 

									invdetail.setCurrentSublistValue({
										sublistId: 'inventoryassignment',
										fieldId: 'binnumber',
										value: itemQuantities[lineItemNum].binid
									});


								

									
									binTranRecord.setCurrentSublistValue({
										"sublistId": "inventory",
										"fieldId": "frombins",
										"value": itemQuantities[lineItemNum].binid
									});
									
								
								
								
									log.debug('sublist value set', itemQuantities[lineItemNum].quantity);
									binTranRecord.setCurrentSublistValue({
										"sublistId": "inventory",
										"fieldId": "quantity",
										"value": (lineItemQuantity - itemQuantities[lineItemNum].quantity)
									});
									
									invdetail.setCurrentSublistValue({
										sublistId: 'inventoryassignment',
										fieldId: 'quantity',
										value: (lineItemQuantity - itemQuantities[lineItemNum].quantity)
									});
									
									if((lineItemQuantity - itemQuantities[lineItemNum].quantity) == 0){
										emptyLines++;
									}
									
									invdetail.commitLine({
										"sublistId": "inventoryassignment"
									});
									binTranRecord.commitLine({
										"sublistId": "inventory"
									});
								}
							}
							else{
								log.debug('false item', lineItemNum);
							}
							
							
							
							
							index++;
							
						}
						//If all lines were removed, just delete the bin transfer
						if(inventoryLineCount == 0){
							log.debug('Delete BinTransfer', binTransfer);
							//delete bin transfer
							var pickTaskTX = record.delete({
							   type: 'bintransfer',
							   id: binTransfer,
							});
						}
						//Otherwise push the update
						else{
							log.debug('Bin Transfer ID: ' + binTransfer, 'Quantities Removed: ' + itemQuantities);
							//update bin transfer
							
							
							var recordId = binTranRecord.save({
								enableSourcing: false,
								ignoreMandatoryFields: true
							});
						}
					}
					
					
					
				}
				
				//deactivate carton and update comment field
				var cartonId;
				var customrecord_rfs_lp_headerSearchObj = search.create({
				   type: "customrecord_rfs_lp_header",
				   filters:
				   [
					  ["name","is",sscc]
				   ],
				   columns:
				   [
					  search.createColumn({name: "internalid", label: "Internal ID"})
				   ]
				});
				
				customrecord_rfs_lp_headerSearchObj.run().each(function(result){
				   cartonId = result.getValue({name: "internalid"})
				   return true;
				});
				
				var id = record.submitFields({
					type: 'customrecord_rfs_lp_header',
					id: cartonId,
					values: {
						isinactive: true,
						custrecord_adv_script_note: 'Set to inactive by Delete Mixed Carton suitelet',
					},
					options: {
						enableSourcing: false,
						ignoreMandatoryFields : true
					}
				});

				
				
				
			}
			else{
			
			
				var params = context.request.parameters;
				var ssccNum = context.request.parameters.ssccNum;
				//log.debug('Params', params);
				//log.debug('params.dataSubmitted', params.dataSubmitted);
				
				
				var validMixedCarton = false;
				var atpsData = [];
				var isTaskSuspended = true;
				if(!!ssccNum && ssccNum.length == 20){
					
					var taskpickingstateSearchObj = search.create({
					   type: "customrecord_adv_taskpickingstate",
					   filters:
					   [
						  ["custrecord_adv_taskpickingstate_data","contains",ssccNum], 
					   ],
					   columns:
					   [
						  search.createColumn({
							 name: "id",
							 sort: search.Sort.ASC,
							 label: "ID"
						  }),
						  search.createColumn({name: "custrecord_adv_taskpickingstate_data", label: "Data"}),
						  search.createColumn({name: "custrecord_rfs_picktask_status", join: "custrecord_adv_taskpickingstate_task_rec", label: "Data"})
   
					   ]
					});
					var searchResultCount = taskpickingstateSearchObj.runPaged().count;
					if(searchResultCount > 0){
						validMixedCarton = true;
						taskpickingstateSearchObj.run().each(function(result) {
							atpsData.push(JSON.parse(result.getValue({name: "custrecord_adv_taskpickingstate_data"})));
							if(result.getValue({name: "custrecord_rfs_picktask_status", join: "custrecord_adv_taskpickingstate_task_rec"}) != 4 && result.getValue({name: "custrecord_rfs_picktask_status", join: "custrecord_adv_taskpickingstate_task_rec"}) != 7){
								isTaskSuspended = false;
							}
							return true;
						});
					}
					
					var customrecord_rfs_lp_headerSearchObj = search.create({
					   type: "customrecord_rfs_lp_header",
					   filters:
					   [
						  ["name","is",ssccNum]
					   ],
					   columns:
					   [
						  search.createColumn({name: "custrecord_rfs_lp_header_properties", label: "Properties"})
					   ]
					});
					customrecord_rfs_lp_headerSearchObj.run().each(function(result){
						if(result.getValue({name: "custrecord_rfs_lp_header_properties"}) != 7){
							validMixedCarton = false;
						}				
					});
				}
				
				
				
				
				var html = '';
				if(!ssccNum || !isTaskSuspended || !validMixedCarton || !!params.dataSubmitted){
					html = '<!DOCTYPE HTML>\
							<html lang="en">\
					<head>\
						<meta charset="UTF-8">\
						<title>Delete Mixed Cartons</title>\
						<link rel="stylesheet" href="https://cdn.datatables.net/1.11.1/css/jquery.dataTables.min.css" />\
						<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js"></script>\
						<script src="https://cdn.datatables.net/1.11.1/js/jquery.dataTables.min.js"></script>';
						
						
					html += '<script>\
					jQuery(document).ready( function () {\
					jQuery("#submitSSCC").on("click", function(){';
						html += SubmitSSCC(suiteletUrl);
						html += '});	\
					} );</script>';
					
					html +='<script>function ReplaceString(text){\
						return text;\
					}\
					</script>';
					
					html += '<script>\
					jQuery(document).ready( function () {\
					jQuery("#returnToRFSmart").on("click", function(){';
						html += ReturnToRFSmart();
						html += '});	\
					} );</script>\
					<style type="text/css">\
						html, body {\
							 margin: 0;\
							padding: 0;\
						}		\
					</style>\
					</head>';
						
						html += '<body style="padding: 0; margin: 0"><div style="background-color: #65738f; margin: 0; padding: 5px"><input type="button" name="returnToRFSmart" id="returnToRFSmart" value="Return to RF-Smart" style="background-color: #193369; color:white; width:135px; height: 35px" /></div>'
						if(!!ssccNum && (!params.dataSubmitted || params.dataSubmitted != 1)){
							if(ssccNum.length != 20){
								//not valid ssccNum
								html += '<p style="font-size: 35px; text-align: center"><b>This is not a valid Carton Number. Please scan and try again</b></p>';
							}
							else if(searchResultCount < 1){
								//No ATPS found with that SSCC
								html += '<p style="font-size: 35px; text-align: center"><b>There was no Task Picking State found. Please scan and try again</b></p>';
							}
							if(!validMixedCarton && searchResultCount != 0){
								//Not a mixed carton
								html += '<p style="font-size: 35px; text-align: center"><b>This is not a mixed carton. Please scan and try again</b></p>';
							}
							if(!isTaskSuspended && validMixedCarton){
								//Not suspended
								html += '<p style="font-size: 35px; text-align: center"><b>The task related to this carton is not suspended or in review. Please suspend the task and try again</b></p>';
							}
								
								
						}
						if(params.dataSubmitted == '1'){
							html += '<p style="font-size: 35px; text-align: center">The carton has been deleted. You can return to RF-Smart or scan another carton.</p>';
						}
						else if(params.dataSubmitted == '-1'){
							html += '<p style="font-size: 35px; text-align: center" id="testID">Something went wrong when deleting the Mixed Carton. Please contact your administrator.</p>';
						}
						else if(params.dataSubmitted == '-2'){
							html += '<p style="font-size: 35px; text-align: center" id="testID">Bin Transfer not found. Please contact your administrator.</p>';
						}
						else if(params.dataSubmitted == '-3'){
							html += '<p style="font-size: 35px; text-align: center" id="testID">Advantus Task Picking State Data not found. Please contact your administrator.</p>';
						}
						else if(params.dataSubmitted == '-4'){
							html += '<p style="font-size: 35px; text-align: center" id="testID">Advantus Task Picking State ID not found. Please contact your administrator.</p>';
						}
						else if(params.dataSubmitted == '-5'){
							html += '<p style="font-size: 35px; text-align: center" id="testID">Pick Task TX ID not found. Please contact your administrator.</p>';
						}
						else if(params.dataSubmitted == '-6'){
							html += '<p style="font-size: 35px; text-align: center" id="testID">Pick Task TX quantity not found. Please contact your administrator.</p>';
						}
						else if(params.dataSubmitted == '-7'){
							html += '<p style="font-size: 35px; text-align: center" id="testID">Bin Transfer Record not found. Please contact your administrator.</p>';
						}
						html += '<p style="font-size: 25px; text-align: center">Please enter a Mixed Carton number <br/><br/><input type="text" name="ssccNum" id="ssccNum" value=""   style="width: 240px; height: 20px; font-size: 20"/><br/><br/>\
						<input type="button" name="submitSSCC" id="submitSSCC" value="Submit"  style="width: 120px; height: 35px; font-size: 20px" /></p>';
							
						
						
					html += '</body>\
					</html>';
				}
				else{
					
					var lpHeaderSearchObj = search.create({
					   type: "customrecord_rfs_lp_header",
					   filters:
					   [
							["name","is",ssccNum]
					   ],
					   columns:
					   [
							search.createColumn({name: "custrecord_rfs_lp_header_parent", label: "Parent License Plate"}),
					   ]
					});
					var palletLP;
					lpHeaderSearchObj.run().each(function(result) {
						palletLP = result.getText({name: "custrecord_rfs_lp_header_parent"})
					});
					
					
					html = '<!DOCTYPE HTML>\
							<html lang="en">\
					<head>\
						<meta charset="UTF-8">\
						<title>Delete Mixed Cartons</title>\
						<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js"></script>\
						<script src="https://cdn.datatables.net/1.11.1/js/jquery.dataTables.min.js"></script>';
						
						
					html += '<script>\
					jQuery(document).ready( function () {\
					jQuery("#deleteMixedCarton").on("click", function(){';
						html += DeleteMixedCarton();
						html += '});	\
					} );</script>';
					
					html += '<script>\
					jQuery(document).ready( function () {\
					jQuery("#confirmDeleteButton").on("click", function(){';
						html += ConfirmDelete(suiteletUrl);
						html += '});	\
					} );</script>';
					
					html +='<script>function ReplaceString(text){\
						return text;\
					}\
					</script>';
					
					
					
					
					html += '<script>\
					jQuery(document).ready( function () {\
					jQuery("#returnToRFSmart").on("click", function(){';
						html += ReturnToRFSmart();
						html += '});	\
					} );</script>\
					<style type="text/css">\
						html, body {\
							 margin: 0;\
							padding: 0;\
						}		\
					</style>\
					</head>';
						
						html += '</div>';
						html += '<div style="background-color: #65738f; margin: 0; padding: 5px"><input type="button" name="returnToRFSmart" id="returnToRFSmart" value="Return to RF-Smart" style="background-color: #193369; color:white; width:135px; height: 35px" /></div>'
						if(!!palletLP){
							html += '<p style="font-size: 25px; text-align: center">Pallet LP: ' + palletLP + '</p>';
						}
						html +=  '<p style="font-size: 25px; text-align: center">Carton LP: ' + ssccNum + '</p>';
						html += '<p style="font-size: 15px; text-align: center">';
						for (var index in atpsData) {
							for(var i in atpsData[index]) {
									//log.debug('atpsData[index]', atpsData[index][i].licenseplatenumber);
								if(ssccNum == atpsData[index][i].licenseplatenumber){
									//log.debug('atpsData[index]', atpsData[index][i].pickdetails.item.name);
									html += 'Item: ' + atpsData[index][i].pickdetails.item.name + '   Quantity: ' + atpsData[index][i].pickdetails.quantity + '<br/>';
								}
							}
							
						}
						html += '</p>';
						html += '<p  style="font-size: 25px; text-align: center"><input type="button" name="deleteMixedCarton" id="deleteMixedCarton" value="Delete Mixed Carton"  style="width: 150px; height: 35px; font-size: 15px" /></p><p name="originalSSCC" id="originalSSCC" hidden>' + ssccNum + '</p>';
						html += '<p name="confirmText" id="confirmText" hidden style="font-size: 25px; text-align: center">Rescan Mixed Carton LP number to confirm.</p><p style="text-align:center"><input hidden type="text" name="confirmSSCC" id="confirmSSCC"    style="width: 240px; height: 20px; font-size: 20"  /></p><p  style="font-size: 25px; text-align: center"><input hidden type="button" name="confirmDeleteButton" id="confirmDeleteButton" value="Confirm Delete"   style="width: 150px; height: 35px; font-size: 15px" /></p>';
							
						
						
					html += '</body>\
					</html>';
				}

				context.response.write(html);
			}
        }

		
		function SubmitSSCC(suiteletUrl){
			
			var htmlString = 'var suiteletURL = "' + suiteletUrl + '";\
			document.getElementById("submitSSCC").value="Processing";\
			document.getElementById("submitSSCC").disabled=true;\
			if(!!document.getElementById("ssccNum").value){\
				suiteletURL += "&ssccNum="+ReplaceString(document.getElementById("ssccNum").value);\
			}';
			
			htmlString += 'window.open(suiteletURL, "_self");';
			return htmlString;
			
			
		}
		
		function DeleteMixedCarton(){
			var htmlString = 'var confirmText = document.getElementById("confirmText");\
				var confirmField = document.getElementById("confirmSSCC");\
				var confirmButton = document.getElementById("confirmDeleteButton");\
				var deleteButton = document.getElementById("deleteMixedCarton");\
				deleteButton.style.display = "none";\
				confirmText.removeAttribute("hidden");\
				confirmField.removeAttribute("hidden");\
				confirmButton.removeAttribute("hidden");';
			
			return htmlString;
		}
		
		function ConfirmDelete(suiteletUrl){
			
			var htmlString = 'if(document.getElementById("originalSSCC").innerHTML != document.getElementById("confirmSSCC").value){\
				console.log(document.getElementById("originalSSCC").innerHTML);\
				console.log(document.getElementById("confirmSSCC").value);\
				document.getElementById("confirmText").innerHTML = "Entered value does not match. Please try again.";\
			}else{\
				document.getElementById("confirmDeleteButton").value="Processing";\
				document.getElementById("confirmDeleteButton").disabled=true;\
				document.getElementById("returnToRFSmart").disabled=true;\
			var originalSSCC = document.getElementById("originalSSCC").innerHTML;\
			var suiteletURL = "' + suiteletUrl + '";';
			
			htmlString+='$.ajax({\
					type: "POST",\
					url: suiteletURL,\
					data: {\
						originalSSCC: originalSSCC,\
						},\
					success: function(data) {\
						$("#endpointResponse").html(data);\
						urlParams = new URLSearchParams(window.location.search);\
						urlParams.set("dataSubmitted", 1);\
						urlParams.set("ssccNum", "");\
						window.location.search = urlParams;\
					},\
					error: function(data){\
						var jsonData = JSON.stringify(data);\
						var index = jsonData.indexOf("A----");\
						var endIndex = jsonData.indexOf("----A");\
						console.log(jsonData);\
						console.log(index);\
						console.log(endIndex);\
						var errorMessage = jsonData.substring((index + 5), endIndex);\
						var dataSubmitted = -1;\
						if(errorMessage == "bin transfer not found"){\
							dataSubmitted = -2;\
						}\
						else if(errorMessage == "ATPS Data not found"){\
							dataSubmitted = -3;\
						}\
						else if(errorMessage == "ATPS ID not found"){\
							dataSubmitted = -4;\
						}\
						else if(errorMessage == "Pick Task TX Id not found"){\
							dataSubmitted = -5;\
						}\
						else if(errorMessage == "Picktask TX Quantity not found"){\
							dataSubmitted = -6;\
						}\
						else if(errorMessage == "Bin Transfer record not found"){\
							dataSubmitted = -7;\
						}\
						console.log(errorMessage);\
						$("#endpointResponse").html(data);\
						urlParams = new URLSearchParams(window.location.search);\
						urlParams.set("dataSubmitted", dataSubmitted);\
						window.location.search = urlParams;\
					},\
					async:true,\
					accept:"application/json",\
			})}';
			
			return htmlString;
			
		}
		
		function ReturnToRFSmart(){
			var htmlString = 'window.open("https://5050497.app.netsuite.com/app/site/hosting/scriptlet.nl?script=1130&deploy=1&compid=5050497&whence=", "_self");';
			//var htmlString = 'history.back();';
			return htmlString;
		}


        return {
			onRequest: onRequestFxn 
        };
    }
);