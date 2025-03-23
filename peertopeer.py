import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
import os
import logging
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import time

# Configure the logger
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load dataset
script_dir = os.path.dirname(os.path.abspath(__file__))
file_path = os.path.join(script_dir, 'peertopeer.xlsx')
df = pd.read_excel(file_path)

# MongoDB connection
MONGO_URI = os.getenv("MONGODB_URI")  # Load MongoDB URI from environment variables
DATABASE_NAME = "ecopulse"  # Replace with your database name
COLLECTION_NAME = "peertopeer"  # Replace with your collection name

def connect_to_mongodb_peertopeer(retries=3, delay=5):
    """
    Connect to MongoDB Atlas and return the collection.
    Retries the connection in case of failure.
    """
    for attempt in range(retries):
        try:
            client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
            db = client[DATABASE_NAME]
            collection = db[COLLECTION_NAME]
            # Attempt to ping the server to check the connection
            client.admin.command('ping')
            logger.debug("Connected to MongoDB Atlas successfully.")
            return collection
        except ConnectionFailure as e:
            logger.error(f"Error connecting to MongoDB (attempt {attempt + 1}): {e}")
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                raise

def createPeertoPeer(data):
    """
    Insert actual data into MongoDB.
    """
    try:
        collection = connect_to_mongodb_peertopeer()
        # Add the isPredicted flag for actual data
        collection.insert_one(data)
        logger.info("Actual data inserted successfully.")
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
    # Drop rows with missing values in the specified column
    df_clean = df.dropna(subset=[column])
    
    # Check if we have any data after dropping NaN values
    if df_clean.empty:
        logger.warning(f"No data available for {column} after dropping NaN values")
        return np.array([target_year]), np.array([0.0])  # Return default values
    
    # Check if the target year is in our dataset
    if target_year in df_clean['Year'].values:
        # Return the actual value for that year
        target_value = df_clean[df_clean['Year'] == target_year][column].values[0]
        logger.debug(f"Found actual value for {column} in year {target_year}: {target_value}")
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
def get_peer_to_predictions(start_year=None, end_year=None):
    """
    Predict energy metrics for a given year range.

    Parameters:
        start_year (int): The start year for predictions. Defaults to 2020 if null.
        end_year (int): The end year for predictions. Defaults to 2026 if null.

    Returns:
        pd.DataFrame: A DataFrame containing predicted values for the selected metrics across the year range.
    """
    if start_year is None:
        start_year = 2020
    
    if end_year is None:
        end_year = 2026
    
    # Ensure end_year is at least equal to start_year
    if end_year < start_year:
        end_year = start_year
        
    logger.debug(f"Generating predictions for year range: {start_year} to {end_year}")
    
    all_predictions = []
    
    # Check if 'Visayas Total Power Generation (GWh)' exists in the DataFrame
    visayas_gen_column = 'Visayas Total Power Generation (GWh)'
    has_visayas_gen = visayas_gen_column in df.columns
    if has_visayas_gen:
        non_null_count = df[visayas_gen_column].count()
        logger.debug(f"Column '{visayas_gen_column}' exists with {non_null_count} non-null values")
    else:
        logger.warning(f"Column '{visayas_gen_column}' not found in DataFrame")
    
    # Predict for each year in the range
    for year in range(start_year, end_year + 1):
        logger.debug(f"Processing predictions for year: {year}")
        
        # Create dictionaries to store Visayas power data
        visayas_power_gen_dict = {}
        visayas_consumption_dict = {}
        
        # Predict Visayas Total Power Generation for the specified year
        if has_visayas_gen and non_null_count > 0:
            try:
                future_years, visayas_power_gen_predictions = predict_future(df, visayas_gen_column, target_year=year)
                visayas_power_gen_dict = dict(zip(future_years, visayas_power_gen_predictions))
            except Exception as e:
                logger.error(f"Error predicting Visayas Total Power Generation for year {year}: {e}")
        
        # Predict Visayas Total Power Consumption for the specified year
        visayas_consumption_column = 'Visayas Total Power Consumption (GWh)'
        if visayas_consumption_column in df.columns:
            try:
                future_years, visayas_consumption_predictions = predict_future(df, visayas_consumption_column, target_year=year)
                visayas_consumption_dict = dict(zip(future_years, visayas_consumption_predictions))
            except Exception as e:
                logger.error(f"Error predicting Visayas Total Power Consumption for year {year}: {e}")
        else:
            logger.warning(f"Column '{visayas_consumption_column}' not found in DataFrame")
    
        # Iterate over each subgrid (place)
        for place, df_place in subgrid_data.items():
            logger.debug(f"Processing data for {place} for year {year}")
    
            # Check if the required columns exist in the DataFrame
            if 'Total Power Generation (GWh)' in df_place.columns:
                try:
                    # Predict the place's total power generation
                    future_years, power_generation_predictions = predict_future(df_place, 'Total Power Generation (GWh)', target_year=year)
                    
                    # Only add predictions for the current year we're processing
                    for i, yr in enumerate(future_years):
                        if yr == year:
                            logger.debug(f"Predicted Power Generation for {place} in {year}: {power_generation_predictions[i]}")
                            
                            # Add to predictions
                            predictions_df = pd.DataFrame({
                                'Year': [year],
                                'Place': [place],
                                'Energy Type': ['Total Power Generation (GWh)'],
                                'Predicted Value': [power_generation_predictions[i]]
                            })
                            all_predictions.append(predictions_df)
                            
                            # Calculate and add consumption prediction
                            if yr in visayas_power_gen_dict and yr in visayas_consumption_dict:
                                try:
                                    visayas_power_gen = visayas_power_gen_dict.get(yr)
                                    visayas_consumption = visayas_consumption_dict.get(yr)
                                    
                                    if visayas_power_gen != 0:  # Prevent division by zero
                                        # Calculate ratio and consumption
                                        ratio = power_generation_predictions[i] / visayas_power_gen
                                        place_consumption = ratio * visayas_consumption
                                        
                                        predictions_df_consumption = pd.DataFrame({
                                            'Year': [year],
                                            'Place': [place],
                                            'Energy Type': [f'{place} Estimated Consumption (GWh)'],
                                            'Predicted Value': [place_consumption]
                                        })
                                        all_predictions.append(predictions_df_consumption)
                                except Exception as e:
                                    logger.error(f"Error calculating consumption for {place} in year {year}: {e}")
                except Exception as e:
                    logger.error(f"Error predicting Total Power Generation for {place} in year {year}: {e}")
            else:
                logger.warning(f"Column 'Total Power Generation (GWh)' not found for {place}")
    
            # Predict future values for each metric
            for metric in metrics:
                if metric in df_place.columns:
                    try:
                        future_years, predictions = predict_future(df_place, metric, target_year=year)
                        
                        # Only add prediction for the current year
                        for i, yr in enumerate(future_years):
                            if yr == year:
                                predictions_df = pd.DataFrame({
                                    'Year': [year],
                                    'Place': [place],
                                    'Energy Type': [metric],
                                    'Predicted Value': [predictions[i]]
                                })
                                all_predictions.append(predictions_df)
                    except Exception as e:
                        logger.error(f"Error predicting {metric} for {place} in year {year}: {e}")
    
    # Combine all predictions into a single DataFrame
    if all_predictions:
        all_predictions_df = pd.concat(all_predictions, ignore_index=True)
        return all_predictions_df
    else:
        logger.warning("No predictions generated for the specified year range.")
        return pd.DataFrame()