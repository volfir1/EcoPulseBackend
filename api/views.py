# filepath: /d:/TUP/ECOPULSE/backend/api/views.py
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from linearregression_predictiveanalysis import get_predictions, create, connect_to_mongodb  # Import the function here
from peertopeer import get_peer_to_predictions, createPeertoPeer, connect_to_mongodb_peertopeer
from recommendations import get_solar_recommendations, recommendation_records, connect_to_mongodb_recommendation
import logging
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.views import View
import json
from django.views.decorators.http import require_http_methods
from bson import ObjectId
from pymongo import MongoClient

# Configure the logger
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

@require_GET
def get_renewable_energy_predictions(request, target):
    """
    API endpoint to get renewable energy predictions for a specific target.
    """
    try:
        start_year = request.GET.get('start_year', None)
        end_year = request.GET.get('end_year', None)
        if start_year:
            start_year = int(start_year)
        else:
            start_year = 2024  # Default start year if not provided
        if end_year:
            end_year = int(end_year)
        else:
            end_year = 2040
        
        # Log the request parameters
        logger.debug(f"Received request for target: {target}, start_year: {start_year}, end_year: {end_year}")
        
        # Get predictions for the specified target
        predictions = get_predictions(target, start_year, end_year)
        
        # Convert the DataFrame to a dictionary for JSON response
        predictions_dict = predictions.to_dict(orient='records')
        
        return JsonResponse({
            'status': 'success',
            'target': target,
            'predictions': predictions_dict
        })
    except Exception as e:
        logger.error(f"Error in get_renewable_energy_predictions: {e}")
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=500)

@require_GET
def peertopeer_predictions(request):
    """
    API endpoint to get predictions based on year and filters.
    """
    try:
        year = request.GET.get('year')

        # Convert year to integer
        if year:
            year = int(year)
        else:
            year = 2026  # Default year if not provided

        # Split filters into a list

        logger.debug(f"Received request with year: {year}")

        # Get predictions for the specified year and filters
        predictions = get_peer_to_predictions(year)
        
        # Convert the DataFrame to a dictionary for JSON response
        predictions_dict = predictions.to_dict(orient='records')
        
        return JsonResponse({
            'status': 'success',
            'predictions': predictions_dict
        })
    except Exception as e:
        logger.error(f"Error in peertopeer_predictions: {e}")
        return JsonResponse({
            'status': 'error',
            'message': str(e)}
        , status=500)

@require_GET
def solar_recommendations(request):
    """
    API endpoint to get solar recommendations based on year and budget.
    """
    try:
        year = int(request.GET.get('year', 2026))
        budget = float(request.GET.get('budget', 0))

        logger.debug(f"Received request with year: {year}, budget: {budget}")

        # Get solar recommendations
        recommendations = get_solar_recommendations(year, budget)
        
        return JsonResponse({
            'status': 'success',
            'recommendations': recommendations
        })
    except Exception as e:
        logger.error(f"Error in solar_recommendations: {e}")
        return JsonResponse({
            'status': 'error',
            'message': str(e)}, status=500)

@method_decorator(csrf_exempt, name='dispatch')
class CreateView(View):
    def post(self, request):
        """
        API endpoint to insert actual data into MongoDB.
        """
        try:
            data = json.loads(request.body)
            create(data)
            return JsonResponse({'status': 'success', 'message': 'Data inserted successfully'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)
        
@method_decorator(csrf_exempt, name='dispatch')
class CreateViewPeertoPeer(View):
    def post(self, request):
        """
        API endpoint to insert actual data into MongoDB.
        """
        try:
            data = json.loads(request.body)
            createPeertoPeer(data)
            return JsonResponse({'status': 'success', 'message': 'Data inserted successfully'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

@require_http_methods(["PUT"])
@csrf_exempt
def update_record(request, year):
    """
    API endpoint to update an existing record in MongoDB using the year.
    """
    try:
        data = json.loads(request.body)
        collection = connect_to_mongodb()
        
        # Log the incoming data and year
        logger.debug(f"Updating record for Year: {year} with data: {data}")
        
        # Fetch the existing record
        existing_record = collection.find_one({"Year": int(year)})
        if not existing_record:
            logger.error(f"Record not found for Year: {year}")
            return JsonResponse({'status': 'error', 'message': 'Record not found'}, status=404)
        
        # Calculate the new values for Total Power Generation and Total Renewable Energy
        total_renewable_energy = (
            data.get('Geothermal (GWh)', existing_record.get('Geothermal (GWh)', 0)) +
            existing_record.get('Hydro (GWh)', 0) +
            existing_record.get('Biomass (GWh)', 0) +
            existing_record.get('Solar (GWh)', 0) +
            existing_record.get('Wind (GWh)', 0)
        )
        
        total_power_generation = (
            total_renewable_energy +
            data.get('Non-Renewable Energy (GWh)', existing_record.get('Non-Renewable Energy (GWh)', 0))
        )
        
        # Update the data with the new calculated values
        data['Total Renewable Energy (GWh)'] = total_renewable_energy
        data['Total Power Generation (GWh)'] = total_power_generation
        
        result = collection.update_one(
            {"Year": int(year)},
            {"$set": data}
        )
        
        if result.matched_count == 0:
            logger.error(f"Record not found for Year: {year}")
            return JsonResponse({'status': 'error', 'message': 'Record not found'}, status=404)
        
        logger.info(f"Record updated successfully for Year: {year}")
        return JsonResponse({'status': 'success', 'message': 'Record updated successfully'})
    except Exception as e:
        logger.error(f"Error updating record: {e}")
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

@require_http_methods(["DELETE"])
@csrf_exempt
def delete_record(request, year):
    """
    API endpoint to soft delete an existing record in MongoDB using the year.
    """
    try:
        collection = connect_to_mongodb()
        
        # Log the year of the record to be soft deleted
        logger.debug(f"Soft deleting record for Year: {year}")
        
        result = collection.update_one(
            {"Year": int(year)},
            {"$set": {"isDeleted": True}}
        )
        
        if result.matched_count == 0:
            logger.error(f"Record not found for Year: {year}")
            return JsonResponse({'status': 'error', 'message': 'Record not found'}, status=404)
        
        logger.info(f"Record soft deleted successfully for Year: {year}")
        return JsonResponse({'status': 'success', 'message': 'Record soft deleted successfully'})
    except Exception as e:
        logger.error(f"Error soft deleting record: {e}")
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

@require_http_methods(["PUT"])
@csrf_exempt
def recover_record(request, year):
    """
    API endpoint to recover a soft deleted record in MongoDB using the year.
    """
    try:
        collection = connect_to_mongodb()
        
        # Log the year of the record to be recovered
        logger.debug(f"Recovering record for Year: {year}")
        
        result = collection.update_one(
            {"Year": int(year)},
            {"$set": {"isDeleted": False}}
        )
        
        if result.matched_count == 0:
            logger.error(f"Record not found for Year: {year}")
            return JsonResponse({'status': 'error', 'message': 'Record not found'}, status=404)
        
        logger.info(f"Record recovered successfully for Year: {year}")
        return JsonResponse({'status': 'success', 'message': 'Record recovered successfully'})
    except Exception as e:
        logger.error(f"Error recovering record: {e}")
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

# MongoDB API endpoints for peer-to-peer data
def peertopeer_records(request):
    """
    Endpoints to fetch, create, and list peer-to-peer energy records from MongoDB
    """
    try:
        # Get MongoDB collection
        collection = connect_to_mongodb_peertopeer()
        
        if request.method == 'GET':
            # Extract parameters
            start_year = request.GET.get('startYear')
            end_year = request.GET.get('endYear')
            
            # Build query
            query = {}
            if start_year and end_year:
                # Check both year and Year fields to be compatible with different formats
                start_year = int(start_year)
                end_year = int(end_year)
                query = {
                    "$or": [
                        {"year": {"$gte": start_year, "$lte": end_year}},
                        {"Year": {"$gte": start_year, "$lte": end_year}}
                    ]
                }
            
            # Fetch records
            records_cursor = collection.find(query)
            records = []
            
            # Process each record
            for record in records_cursor:
                # Convert ObjectId to string for JSON serialization
                record['_id'] = str(record['_id'])
                records.append(record)
            
            # Return records as JSON response
            return JsonResponse({
                'status': 'success',
                'records': records
            })
            
        elif request.method == 'POST':
            # Parse request body
            data = json.loads(request.body)
            
            # Insert new record
            result = collection.insert_one(data)
            
            # Return success response with new record ID
            return JsonResponse({
                'status': 'success',
                'message': 'Record created successfully',
                'id': str(result.inserted_id)
            })
            
        else:
            return JsonResponse({
                'status': 'error',
                'message': 'Method not allowed'
            }, status=405)
            
    except Exception as e:
        # Log the error
        import logging
        logging.error(f"Error in peertopeer_records: {str(e)}")
        
        # Return error response
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=500)

@csrf_exempt
def peertopeer_record_detail(request, record_id):
    """
    Endpoints to fetch, update, or delete a specific peer-to-peer energy record from MongoDB
    """
    try:
        # Get MongoDB collection - fix to use peertopeer collection
        collection = connect_to_mongodb_peertopeer()
        
        # Convert string ID to MongoDB ObjectId
        object_id = ObjectId(record_id)
        
        if request.method == 'GET':
            # Fetch record
            record = collection.find_one({'_id': object_id})
            
            if not record:
                return JsonResponse({
                    'status': 'error',
                    'message': 'Record not found'
                }, status=404)
                
            # Convert ObjectId to string for JSON serialization
            record['_id'] = str(record['_id'])
            
            # Return record as JSON response
            return JsonResponse({
                'status': 'success',
                'record': record
            })
            
        elif request.method == 'PUT' or request.method == 'PATCH':
            # Parse request body
            print(f"Processing PUT request for record {record_id}")
            print(f"Request body: {request.body}")
            
            data = json.loads(request.body)
            
            # Remove _id field if it exists
            if '_id' in data:
                del data['_id']
            
            # Log the update operation
            logger.debug(f"Updating record {record_id} with data: {data}")
                
            # Update record
            result = collection.update_one({'_id': object_id}, {'$set': data})
            
            if result.matched_count == 0:
                return JsonResponse({
                    'status': 'error',
                    'message': 'Record not found'
                }, status=404)
                
            # Return success response
            return JsonResponse({
                'status': 'success',
                'message': 'Record updated successfully'
            })
            
        elif request.method == 'DELETE':
            # Delete record
            result = collection.delete_one({'_id': object_id})
            
            if result.deleted_count == 0:
                return JsonResponse({
                    'status': 'error',
                    'message': 'Record not found'
                }, status=404)
                
            # Return success response
            return JsonResponse({
                'status': 'success',
                'message': 'Record deleted successfully'
            })
            
        else:
            return JsonResponse({
                'status': 'error',
                'message': 'Method not allowed'
            }, status=405)
            
    except Exception as e:
        # Log the error
        logger.error(f"Error in peertopeer_record_detail: {str(e)}")
        logger.error(f"Request method: {request.method}")
        logger.error(f"Request headers: {request.headers}")
        
        # Return error response
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=500)
        
@csrf_exempt
def add_recommendation(request):
    """
    Endpoints to fetch and create recommendation records
    """
    try:
        collection = connect_to_mongodb_recommendation()
        
        if request.method == 'GET':
            # Extract parameters for potential filtering
            year = request.GET.get('year')
            
            # Build query
            query = {}
            if year:
                query["Year"] = int(year)
            
            # Fetch records
            records_cursor = collection.find(query)
            records = []
            
            # Process each record
            for record in records_cursor:
                # Convert ObjectId to string for JSON serialization
                record['_id'] = str(record['_id'])
                records.append(record)
            
            return JsonResponse({
                'status': 'success',
                'records': records
            })
            
        elif request.method == 'POST':
            # Parse request body
            data = json.loads(request.body)
            
            # Ensure Year is stored as integer
            if 'Year' in data:
                data['Year'] = int(data['Year'])
                
            # Insert new record
            result = collection.insert_one(data)
            
            # Return success response with new record ID
            return JsonResponse({
                'status': 'success',
                'message': 'Recommendation created successfully',
                'id': str(result.inserted_id)
            })
            
        else:
            return JsonResponse({
                'status': 'error',
                'message': 'Method not allowed'
            }, status=405)
            
    except Exception as e:
        # Log the error
        logger.error(f"Error in recommendation_records: {str(e)}")
        
        # Return error response
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=500)

@csrf_exempt
def recommendation_record_detail(request, record_id):
    """
    Endpoints to fetch, update, or delete a specific recommendation record from MongoDB
    """
    try:
        # Get MongoDB collection
        collection = connect_to_mongodb_recommendation()
        
        # Convert string ID to MongoDB ObjectId
        object_id = ObjectId(record_id)
        
        if request.method == 'GET':
            # Fetch record
            record = collection.find_one({'_id': object_id})
            
            if not record:
                return JsonResponse({
                    'status': 'error',
                    'message': 'Recommendation record not found'
                }, status=404)
                
            # Convert ObjectId to string for JSON serialization
            record['_id'] = str(record['_id'])
            
            # Return record as JSON response
            return JsonResponse({
                'status': 'success',
                'record': record
            })
            
        elif request.method == 'PUT' or request.method == 'PATCH':
            # Parse request body
            logger.debug(f"Processing PUT request for recommendation record {record_id}")
            data = json.loads(request.body)
            
            # Remove _id field if it exists
            if '_id' in data:
                del data['_id']
            
            # Ensure Year is stored as integer
            if 'Year' in data:
                data['Year'] = int(data['Year'])
            
            # Log the update operation
            logger.debug(f"Updating recommendation record {record_id} with data: {data}")
                
            # Update record
            result = collection.update_one({'_id': object_id}, {'$set': data})
            
            if result.matched_count == 0:
                return JsonResponse({
                    'status': 'error',
                    'message': 'Recommendation record not found'
                }, status=404)
                
            # Return success response
            return JsonResponse({
                'status': 'success',
                'message': 'Recommendation record updated successfully'
            })
            
        elif request.method == 'DELETE':
            # Delete record
            result = collection.delete_one({'_id': object_id})
            
            if result.deleted_count == 0:
                return JsonResponse({
                    'status': 'error',
                    'message': 'Recommendation record not found'
                }, status=404)
                
            # Return success response
            return JsonResponse({
                'status': 'success',
                'message': 'Recommendation record deleted successfully'
            })
            
        else:
            return JsonResponse({
                'status': 'error',
                'message': 'Method not allowed'
            }, status=405)
            
    except Exception as e:
        # Log the error
        logger.error(f"Error in recommendation_record_detail: {str(e)}")
        
        # Return error response
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=500)