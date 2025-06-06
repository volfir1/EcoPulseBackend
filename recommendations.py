import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from sklearn.preprocessing import PolynomialFeatures
from sklearn.linear_model import LinearRegression
import os
import time
import logging
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import json
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse

# Configure logger
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load dataset
script_dir = os.path.dirname(os.path.abspath(__file__))
file_path = os.path.join(script_dir, 'recommendation.xlsx')

try:
    df = pd.read_excel(file_path)
    logger.info(f"Successfully loaded data from {file_path}")
except Exception as e:
    logger.error(f"Error loading data from {file_path}: {e}")
    df = pd.DataFrame()  # Create empty DataFrame as fallback

# Function to check if actual data exists for a specific year
def get_actual_data_for_year(year):
    """
    Check if actual data (not predicted) exists for the given year.
    
    Parameters:
        year (int): The year to check for actual data
        
    Returns:
        dict: Actual data if found, None otherwise
    """
    try:
        if 'isPredicted' in df.columns and 'Year' in df.columns:
            actual_data = df[(df['Year'] == year) & (df['isPredicted'] == False)]
            
            if not actual_data.empty:
                # Convert DataFrame row to dict
                actual_values = actual_data.iloc[0].to_dict()
                logger.info(f"Found actual data for year {year}")
                return actual_values
            
        logger.debug(f"No actual data found for year {year}")
        return None
    except Exception as e:
        logger.error(f"Error checking for actual data: {e}")
        return None

# Prepare data
X = df[['Year']].values.flatten()  # Convert to 1D array
y_solar_cost = df['Solar Cost (PHP/W)'] * 1000  # Convert to PHP/kW
y_meralco_rate = df['MERALCO Rate (PHP/kWh)']

# --- Step 1: Fit Exponential Decay Model to Solar Cost ---

# Define the exponential decay function
def exp_decay(x, a, b, c):
    return a * np.exp(-b * (x - X.min())) + c  # Shift x to prevent large exponent values

# Fit the exponential model to the data
popt, _ = curve_fit(exp_decay, X, y_solar_cost, maxfev=5000)

# Function to predict solar cost using the fitted model
def predict_solar_cost(year):
    return max(exp_decay(year, *popt), 20000)  # Keep above PHP 10,000 per kW

# --- Step 2: Fit Polynomial Regression Model to MERALCO Rate ---
poly = PolynomialFeatures(degree=2)  # Quadratic model for MERALCO rates
X_poly = poly.fit_transform(X.reshape(-1, 1))  # Transform X for polynomial regression

# Train Polynomial Regression for MERALCO Rate
model_meralco = LinearRegression()
model_meralco.fit(X_poly, y_meralco_rate)

# --- Step 3: Prediction Function ---
def predict_solar_capacity_and_roi(budget, year):
    """
    Calculate solar capacity and ROI for a given budget and year.
    Use actual data if available, otherwise generate predictions.
    """
    # First check if we have actual data for this year
    actual_data = get_actual_data_for_year(year)
    
    if actual_data and 'Solar Cost (PHP/W)' in actual_data and 'MERALCO Rate (PHP/kWh)' in actual_data:
        logger.info(f"Using actual data for year {year} instead of predictions")
        
        # Use actual values from the data
        try:
            solar_cost_php_per_w = float(actual_data['Solar Cost (PHP/W)'])
            predicted_solar_cost = solar_cost_php_per_w * 1000  # Convert to PHP/kW
            predicted_meralco_rate = float(actual_data['MERALCO Rate (PHP/kWh)'])
            
            # Calculate with actual values
            capacity_kw = budget / predicted_solar_cost if predicted_solar_cost > 0 else 0
            avg_daily_production_kwh = 4  # kWh per kW per day
            yearly_energy_production = capacity_kw * avg_daily_production_kwh * 365
            yearly_savings = yearly_energy_production * predicted_meralco_rate
            roi_years = budget / yearly_savings if yearly_savings > 0 else float('inf')
            
            return {
                'year': year,
                'predicted_solar_cost': predicted_solar_cost,
                'predicted_meralco_rate': predicted_meralco_rate,
                'capacity_kw': capacity_kw,
                'yearly_energy_production': yearly_energy_production,
                'yearly_savings': yearly_savings,
                'roi_years': roi_years,
                'is_actual_data': True
            }
        except Exception as e:
            logger.error(f"Error using actual data: {e}. Falling back to predictions.")
            # Fall through to predictions if actual data processing fails
    
    # If no actual data or processing failed, generate predictions
    try:
        # Ensure inputs are valid numbers
        budget = float(budget)
        year = int(year)
        
        year_poly = poly.transform(np.array([[year]]))  # Transform year for polynomial model

        predicted_solar_cost = predict_solar_cost(year)  # Exponential decay for solar cost
        predicted_meralco_rate = max(model_meralco.predict(year_poly)[0], 0)  # Polynomial regression for MERALCO rate

        # Calculate installable solar capacity
        capacity_kw = budget / predicted_solar_cost if predicted_solar_cost > 0 else 0

        # Assume average daily solar production per kW
        avg_daily_production_kwh = 4  # kWh per kW per day

        # Calculate yearly energy production
        yearly_energy_production = capacity_kw * avg_daily_production_kwh * 365

        # Calculate yearly savings
        yearly_savings = yearly_energy_production * predicted_meralco_rate

        # Calculate ROI (simple payback period)
        roi_years = budget / yearly_savings if yearly_savings > 0 else float('inf')

        # Display the results
        print(f"Year of Investment: {year}")
        print(f"Predicted Solar Cost: PHP {predicted_solar_cost:.2f} per kW")
        print(f"Predicted MERALCO Rate: PHP {predicted_meralco_rate:.2f} per kWh")
        print(f"Installable Solar Capacity: {capacity_kw:.2f} kW")
        print(f"Estimated Yearly Energy Production: {yearly_energy_production:.2f} kWh")
        print(f"Estimated Yearly Savings: PHP {yearly_savings:.2f}")
        print(f"Estimated ROI (Payback Period): {roi_years:.2f} years")

        return {
            'year': year,
            'predicted_solar_cost': predicted_solar_cost,
            'predicted_meralco_rate': predicted_meralco_rate,
            'capacity_kw': capacity_kw,
            'yearly_energy_production': yearly_energy_production,
            'yearly_savings': yearly_savings,
            'roi_years': roi_years
        }
    except Exception as e:
        logger.error(f"Error in predict_solar_capacity_and_roi: {e}")
        return {
            'year': year,
            'predicted_solar_cost': None,
            'predicted_meralco_rate': None,
            'capacity_kw': None,
            'yearly_energy_production': None,
            'yearly_savings': None,
            'roi_years': None,
            'is_actual_data': False
        }

def get_solar_recommendations(year, budget):
    """
    Get solar recommendations based on the given year and budget.

    Parameters:
        year (int): The target year for the investment.
        budget (float): The budget for the investment in PHP.

    Returns:
        dict: A dictionary containing the predictions for future projections and cost-benefit analysis.
    """
    result = predict_solar_capacity_and_roi(budget, year)
    
    future_projections = {
        'year': year,
        'title': "Solar Investment Projections",
        'Predicted MERALCO Rate': f"PHP {result['predicted_meralco_rate']:.2f} per kWh",
        'Installable Solar Capacity': f"{result['capacity_kw']:.2f} kW"
    }
    
    cost_benefit_analysis = [
        {
            'label': "Estimated Yearly Energy Production",
            'value': f"{result['yearly_energy_production']:.2f} kWh",
            'icon': 'energy',
            'description': "Total energy production per year"
        },
        {
            'label': "Estimated Yearly Savings",
            'value': f"PHP {result['yearly_savings']:.2f}",
            'icon': 'savings',
            'description': "Total savings per year"
        },
        {
            'label': "Estimated ROI (Payback Period)",
            'value': f"{result['roi_years']:.2f} years",
            'icon': 'roi',
            'description': "Return on investment period"
        }
    ]
    
    return {
        'future_projections': future_projections,
        'cost_benefit_analysis': cost_benefit_analysis
    }

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# MongoDB connection details
MONGO_URL = os.getenv("MONGO_URL")  # Load MongoDB URI from environment variables
DATABASE_NAME = "ecopulse"  # Database name
RECOMMENDATION_COLLECTION = "recommendation"  # Collection name for recommendations

def connect_to_mongodb_recommendation(retries=3, delay=5):
    """
    Connect to MongoDB Atlas and return the recommendations collection.
    Retries the connection in case of failure.
    
    Parameters:
        retries (int): Number of connection attempts to make
        delay (int): Seconds to wait between retries
        
    Returns:
        pymongo.collection.Collection: The MongoDB collection for recommendations
    """
    for attempt in range(retries):
        try:
            client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
            db = client[DATABASE_NAME]
            collection = db[RECOMMENDATION_COLLECTION]
            # Attempt to ping the server to check the connection
            client.admin.command('ping')
            logger.debug("Connected to MongoDB Atlas recommendations successfully.")
            return collection
        except ConnectionFailure as e:
            logger.error(f"Error connecting to MongoDB recommendations (attempt {attempt + 1}): {e}")
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                raise

def fetch_recommendation_data():
    """
    Fetch recommendation data from MongoDB.
    Only saves actual (non-predicted) data to Excel.
    """
    try:
        # Connect to MongoDB
        collection = connect_to_mongodb_recommendation()
        
        # Fetch all documents from the collection
        # Only get documents where isPredicted is False or doesn't exist
        cursor = collection.find({"$or": [{"isPredicted": False}, {"isPredicted": {"$exists": False}}]})
        
        # Convert to DataFrame
        df = pd.DataFrame(list(cursor))
        
        if df.empty:
            logger.warning("No actual recommendation data found in MongoDB")
            return None
        
        # Remove MongoDB _id field if it exists
        if '_id' in df.columns:
            df.drop('_id', axis=1, inplace=True)
        
        # Save to Excel, overwriting the existing file
        df.to_excel(file_path, index=False)
        logger.info(f"Successfully saved {len(df)} actual records to {file_path}")
        
        return df
    except Exception as e:
        logger.error(f"Error in fetch_recommendation_data: {e}")
        return None

@csrf_exempt
def recommendation_records(request):
    """
    Handle operations for recommendation records.
    
    GET: Fetch recommendation records, optionally filtered by year
    POST: Create a new recommendation record with isPredicted=False
    
    Parameters:
        request (HttpRequest): The Django HTTP request object
        
    Returns:
        JsonResponse: JSON response with operation status and data
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
            
            # Add the isPredicted flag and set to False for actual data
            data["isPredicted"] = False
                
            # Insert new record
            result = collection.insert_one(data)
            
            # Update Excel with the new data (only actual data)
            fetch_recommendation_data()
            
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