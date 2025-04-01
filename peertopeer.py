import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
import os
import logging
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import time
import datetime

# Configure the logger
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load dataset
script_dir = os.path.dirname(os.path.abspath(__file__))
file_path = os.path.join(script_dir, 'peertopeer.xlsx')
df = pd.read_excel(file_path)

# Ensure correct data types for key columns
if 'Year' in df.columns:
    df['Year'] = pd.to_numeric(df['Year'], errors='coerce')
    
if 'isPredicted' in df.columns:
    # Convert various representations of boolean to actual boolean
    df['isPredicted'] = df['isPredicted'].map(lambda x: str(x).lower() in ('true', 't', '1', 'yes', 'y'))
    logger.debug(f"isPredicted column values: {df['isPredicted'].value_counts().to_dict()}")

# Print dataframe info for debugging
logger.debug(f"DataFrame columns: {df.columns.tolist()}")
logger.debug(f"DataFrame types: {df.dtypes.to_dict()}")
logger.debug(f"DataFrame first 3 rows: {df.head(3)}")

# MongoDB connection
MONGO_URL = os.getenv("MONGO_URL")  # Load MongoDB URI from environment variables
DATABASE_NAME = "ecopulse"  # Replace with your database name
COLLECTION_NAME = "peertopeer"  # Replace with your collection name

def connect_to_mongodb_peertopeer(retries=3, delay=5):
    """
    Connect to MongoDB Atlas with better error handling.
    """
    if not MONGO_URL:
        logger.error("MONGO_URL environment variable is not set")
        raise ValueError("MONGO_URL environment variable is not set")
        
    for attempt in range(retries):
        try:
            logger.debug(f"Attempting to connect to MongoDB (attempt {attempt + 1}/{retries})")
            
            # Parse the MongoDB URL to get the host for logging (hide password)
            mongo_host = MONGO_URL.split('@')[-1].split('/')[0] if '@' in MONGO_URL else MONGO_URL.split('/')[2]
            logger.debug(f"Connecting to MongoDB at {mongo_host}")
            
            client = MongoClient(
                MONGO_URL,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                socketTimeoutMS=10000,
                tls='mongodb+srv' in MONGO_URL,  # Only enable TLS for Atlas
                tlsAllowInvalidCertificates=False  # Disable in production
            )
            db = client[DATABASE_NAME]
            collection = db[COLLECTION_NAME]
            
            # Attempt to ping the server to check the connection
            client.admin.command('ping')
            logger.debug("Connected to MongoDB Atlas successfully.")
            return collection
        except Exception as e:
            logger.error(f"Attempt {attempt + 1} failed: {str(e)}")
            if attempt < retries - 1:
                logger.info(f"Retrying in {delay} seconds...")
                time.sleep(delay)
            else:
                logger.error(f"All {retries} connection attempts to MongoDB failed")
                raise ConnectionError(f"Failed to connect to MongoDB after {retries} attempts: {e}")

def fetch_and_save_data():
    """
    Fetch data from MongoDB and save it to peertopeer.xlsx, with all data as strings.
    """
    try:
        # Connect to MongoDB
        collection = connect_to_mongodb_peertopeer()
        
        # Fetch all documents from the collection
        cursor = collection.find({})
        
        # Convert to DataFrame
        df = pd.DataFrame(list(cursor))
        
        # Remove MongoDB _id field if it exists
        if '_id' in df.columns:
            df.drop('_id', axis=1, inplace=True)
        
        # Convert ALL columns to strings (including numbers)
        for col in df.columns:
            if col != 'isPredicted':  # Keep isPredicted as boolean
                df[col] = df[col].astype(str)  # Force everything to string
        
        # Clean up numeric strings (remove commas for consistency)
        for col in df.columns:
            if col != 'isPredicted' and df[col].dtype == 'object' and df[col].str.contains(',').any():
                df[col] = df[col].str.replace(',', '')  # Remove commas
        
        # Get the path to the Excel file
        script_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(script_dir, 'peertopeer.xlsx')
        
        # Save to Excel, overwriting the existing file
        df.to_excel(file_path, index=False)
        logger.info(f"Successfully saved {len(df)} records to {file_path}")
        
        return df
    except Exception as e:
        logger.error(f"Error in fetch_and_save_data: {e}")
        raise

def createPeertoPeer(data):
    """
    Insert actual data into MongoDB with isPredicted=False flag.
    """
    try:
        collection = connect_to_mongodb_peertopeer()
        
        # Add the isPredicted flag and set to False for actual data
        data_with_flag = {**data, "isPredicted": False}
        
        collection.insert_one(data_with_flag)
        logger.info("Actual data inserted successfully with isPredicted=False.")
        
        # Update the Excel file after insertion
        fetch_and_save_data()  
    except Exception as e:
        logger.error(f"Error inserting actual data: {e}")
        raise

# Display DataFrame columns and first few rows
# print("DataFrame Columns:")
# print(df.columns)
# print("\nFirst few rows of the DataFrame:")
# print(df.head())

# Define subgrid names and metrics
subgrids = ['Bohol', 'Cebu', 'Negros', 'Panay', 'Leyte-Samar']
metrics = [
    'Total Power Generation (GWh)',
    'Total Non-Renewable Energy (GWh)',
    'Total Renewable Energy (GWh)',
    'Geothermal (GWh)',
    'Hydro (GWh)',
    'Biomass (GWh)',
    'Solar (GWh)',
    'Wind (GWh)',
    'Visayas Total Power Consumption (GWh)'  # Ensure this metric is included
]

# Create a dictionary to hold DataFrames for each subgrid
subgrid_data = {}

# Extract data for each subgrid and metric
for subgrid in subgrids:
    # Filter columns that belong to the current subgrid and metrics
    subgrid_columns = ['Year'] + [f'{subgrid} {metric}' for metric in metrics if f'{subgrid} {metric}' in df.columns]

    if len(subgrid_columns) > 1:  # Ensure there are relevant columns
        # Create a DataFrame for the subgrid with 'Year' and its specific columns
        subgrid_df = df[subgrid_columns].copy()

        # Rename columns to remove the subgrid prefix for clarity
        subgrid_df.columns = ['Year'] + [col.replace(f'{subgrid} ', '') for col in subgrid_columns[1:]]

        # Store the DataFrame in the dictionary
        subgrid_data[subgrid] = subgrid_df
    else:
        print(f"No data found for subgrid: {subgrid}")

# Function to perform linear regression and predict future values
def predict_future(df, column, target_year=2040):
    """
    Predict a future value using linear regression.
    First checks if actual data exists for the target year (isPredicted=False).
    """
    # Debug the input data
    logger.debug(f"predict_future: Checking for year {target_year} in column {column}")
    logger.debug(f"DataFrame columns: {df.columns.tolist()}")
    
    # Ensure year is numeric
    target_year = int(target_year)
    
    # First check if we have actual data for this year (not predicted)
    if 'isPredicted' in df.columns and 'Year' in df.columns:
        # Make sure Year is numeric for comparison
        if df['Year'].dtype != 'int64' and df['Year'].dtype != 'float64':
            df['Year'] = pd.to_numeric(df['Year'], errors='coerce')
            
        # Print the unique years in the dataframe for debugging
        logger.debug(f"Years in dataframe: {sorted(df['Year'].unique())}")
        
        # Check for actual data (isPredicted=False) for target year
        actual_data = df[(df['Year'] == target_year) & (df['isPredicted'] == False)]
        logger.debug(f"Found {len(actual_data)} actual data rows for year {target_year}")
        
        if not actual_data.empty and column in actual_data.columns:
            actual_value = actual_data[column].values[0]
            logger.info(f"Using actual value for {column} in year {target_year}: {actual_value}")
            return np.array([target_year]), np.array([float(actual_value)])
    
    # Drop rows with missing values in the specified column
    df_clean = df.dropna(subset=[column])
    
    # Check if we have any data after dropping NaN values
    if df_clean.empty:
        logger.warning(f"No data available for {column} after dropping NaN values")
        return np.array([target_year]), np.array([0.0])  # Return default values
    
    # If target year exists in our dataset (might be actual or predicted)
    if target_year in df_clean['Year'].values:
        # If there's 'isPredicted' column, prioritize non-predicted data
        if 'isPredicted' in df_clean.columns:
            actual_rows = df_clean[(df_clean['Year'] == target_year) & (df_clean['isPredicted'] == "false")]
            if not actual_rows.empty:
                target_value = actual_rows[column].values[0]
                logger.debug(f"Found actual value for {column} in year {target_year}: {target_value}")
                return np.array([target_year]), np.array([target_value])
        
        # Otherwise, use any value for that year
        target_value = df_clean[df_clean['Year'] == target_year][column].values[0]
        logger.debug(f"Found value for {column} in year {target_year}: {target_value}")
        return np.array([target_year]), np.array([target_value])
    
    # Get the maximum and minimum year in the data
    max_year = df_clean['Year'].max()
    min_year = df_clean['Year'].min()
    
    logger.debug(f"Predicting {column} for year {target_year}. Data range: {min_year}-{max_year}")
    
    # For future predictions
    if target_year > max_year:
        try:
            # Prepare the data for regression
            X = df_clean['Year'].values.reshape(-1, 1)  # X is the years
            y = df_clean[column].values  # y is the values
            
            # Fit the model
            model = LinearRegression()
            model.fit(X, y)
            
            # Create single prediction point for the target year
            pred_point = np.array([[target_year]])
            prediction = model.predict(pred_point)
            logger.debug(f"Predicted future value for {column} in year {target_year}: {prediction[0]}")
            return np.array([target_year]), prediction
        except Exception as e:
            logger.error(f"Error predicting future value for {column} in year {target_year}: {e}")
            return np.array([target_year]), np.array([0.0])
    
    # For interpolation (if target_year is between min and max)
    if min_year < target_year < max_year:
        try:
            X = df_clean['Year'].values.reshape(-1, 1)
            y = df_clean[column].values
            
            model = LinearRegression()
            model.fit(X, y)
            
            pred_point = np.array([[target_year]])
            prediction = model.predict(pred_point)
            logger.debug(f"Interpolated value for {column} in year {target_year}: {prediction[0]}")
            return np.array([target_year]), prediction
        except Exception as e:
            logger.error(f"Error interpolating value for {column} in year {target_year}: {e}")
            return np.array([target_year]), np.array([0.0])
    
    # If target_year is before our earliest data
    logger.warning(f"Target year {target_year} is before earliest data point {min_year}")
    return np.array([target_year]), np.array([0.0])

# Function to get predictions based on energy type and year range
def get_peer_to_predictions(year=None):
    """
    Get energy metrics for a specific year.
    Returns actual data if available (isPredicted=False), otherwise generates predictions.
    
    Parameters:
        year (int/str): The year to get data for. Defaults to current year if None.
        
    Returns:
        dict: A dictionary with the structure {
            'year': int,
            'data': list of dicts with place metrics,
            'success': bool,
            'message': str
        }
    """
    try:
        # Convert year to integer (handles string input from API)
        if year is None:
            year = datetime.datetime.now().year
        year = int(year)
        
        logger.debug(f"Processing request for year: {year}")

        # Initialize response structure
        response = {
            'year': year,
            'data': [],
            'success': True,
            'message': 'Data retrieved successfully'
        }

        # Ensure data is properly typed (convert strings to numbers)
        if 'Year' in df.columns:
            df['Year'] = pd.to_numeric(df['Year'], errors='coerce')
        
        # Convert all numeric columns from strings to floats
        for col in df.columns:
            if col not in ['Year', 'isPredicted'] and df[col].dtype == 'object':
                try:
                    df[col] = df[col].str.replace(',', '').astype(float)
                except (AttributeError, ValueError):
                    pass

        # Check for actual data first (isPredicted=False)
        if 'isPredicted' in df.columns:
            actual_data = df[(df['Year'] == year) & (df['isPredicted'] == False)]
            
            if not actual_data.empty:
                logger.info(f"Returning actual data for year {year}")
                for place in subgrids:
                    place_data = {
                        'place': place,
                        'metrics': {},
                        'isPredicted': False
                    }
                    
                    for metric in metrics:
                        col_name = f"{place} {metric}"
                        if col_name in actual_data.columns:
                            value = actual_data[col_name].iloc[0]
                            try:
                                place_data['metrics'][metric] = float(value)
                            except (ValueError, TypeError):
                                place_data['metrics'][metric] = 0.0
                    
                    response['data'].append(place_data)
                return response

        # If no actual data, generate predictions
        logger.info(f"Generating predictions for year {year}")
        
        # Get Visayas totals for consumption calculation
        visayas_gen = 0.0
        visayas_consumption = 0.0
        
        if 'Visayas Total Power Generation (GWh)' in df.columns:
            try:
                _, visayas_gen = predict_future(df, 'Visayas Total Power Generation (GWh)', year)
                visayas_gen = float(visayas_gen[0]) if len(visayas_gen) > 0 else 0.0
            except Exception as e:
                logger.error(f"Error predicting Visayas generation: {e}")

        if 'Visayas Total Power Consumption (GWh)' in df.columns:
            try:
                _, visayas_consumption = predict_future(df, 'Visayas Total Power Consumption (GWh)', year)
                visayas_consumption = float(visayas_consumption[0]) if len(visayas_consumption) > 0 else 0.0
            except Exception as e:
                logger.error(f"Error predicting Visayas consumption: {e}")

        # Generate predictions for each subgrid
        for place, df_place in subgrid_data.items():
            place_data = {
                'place': place,
                'metrics': {},
                'isPredicted': True
            }
            
            # Predict generation
            if 'Total Power Generation (GWh)' in df_place.columns:
                try:
                    _, gen_pred = predict_future(df_place, 'Total Power Generation (GWh)', year)
                    gen_pred = float(gen_pred[0]) if len(gen_pred) > 0 else 0.0
                    place_data['metrics']['Total Power Generation (GWh)'] = gen_pred
                    
                    # Calculate estimated consumption
                    if visayas_gen > 0:
                        ratio = gen_pred / visayas_gen
                        place_data['metrics']['Estimated Consumption (GWh)'] = ratio * visayas_consumption
                except Exception as e:
                    logger.error(f"Error predicting generation for {place}: {e}")
                    place_data['metrics']['Total Power Generation (GWh)'] = 0.0
            
            # Predict other metrics
            for metric in metrics:
                if metric in df_place.columns:
                    try:
                        _, pred = predict_future(df_place, metric, year)
                        place_data['metrics'][metric] = float(pred[0]) if len(pred) > 0 else 0.0
                    except Exception as e:
                        logger.error(f"Error predicting {metric} for {place}: {e}")
                        place_data['metrics'][metric] = 0.0
            
            response['data'].append(place_data)
        
        return response

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            'year': year if 'year' in locals() else datetime.datetime.now().year,
            'data': [],
            'success': False,
            'message': f"Error processing request: {str(e)}"
        }

if __name__ == "__main__":
    try:
        # Check for actual data for year 2024
        if 'Year' in df.columns and 'isPredicted' in df.columns:
            actual_2024 = df[(df['Year'] == 2024) & (df['isPredicted'] == False)]
            print(f"Checking for actual 2024 data: Found {len(actual_2024)} records")
            if not actual_2024.empty:
                print("First actual 2024 record:")
                print(actual_2024.iloc[0])
        
        # Continue with regular execution
        data = fetch_and_save_data()
        print("Data successfully fetched and saved to peertopeer.xlsx")
        print("First few rows of the data:")
        print(data.head())
    except Exception as e:
        print(f"An error occurred: {e}")