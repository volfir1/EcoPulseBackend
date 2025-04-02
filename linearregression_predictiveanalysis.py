import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error
import joblib
import logging
from pymongo import MongoClient
from dotenv import load_dotenv
from pymongo.errors import ConnectionFailure
import time

# Load environment variables from .env file
load_dotenv()

# Configure the logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# MongoDB connection
MONGO_URI = os.getenv("MONGO_URL")  # Load MongoDB URI from environment variables
DATABASE_NAME = "ecopulse"  # Replace with your database name
COLLECTION_NAME = "predictiveAnalysis"  # Replace with your collection name

def connect_to_mongodb(retries=3, delay=5):
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

def create(data):
    """
    Insert actual data into MongoDB.
    """
    try:
        collection = connect_to_mongodb()
        # Add the isPredicted flag for actual data
        data['isPredicted'] = False
        collection.insert_one(data)
        logger.info("Actual data inserted successfully.")
        train_and_save_models()  # Call to train models after inserting data
    except Exception as e:
        logger.error(f"Error inserting actual data: {e}")
        raise

def load_and_preprocess_data():
    """
    Load the dataset from MongoDB and preprocess it by handling missing values.
    """
    try:
        collection = connect_to_mongodb()
        # Fetch all documents from the collection
        data = list(collection.find({}))
        logger.debug(f"Fetched data: {data}")  # Add detailed logging
        # Convert the data to a pandas DataFrame
        df = pd.DataFrame(data)
        # Convert numeric fields from strings to numbers
        numeric_columns = [
            "Total Renewable Energy (GWh)",
            "Geothermal (GWh)",
            "Hydro (GWh)",
            "Biomass (GWh)",
            "Solar (GWh)",
            "Wind (GWh)",
            "Non-Renewable Energy (GWh)",
            "Total Power Generation (GWh)",
            "Population (in millions)",
            "Gross Domestic Product"
        ]
        for col in numeric_columns:
            if df[col].dtype == 'object':
                df[col] = pd.to_numeric(df[col].str.replace(",", ""), errors="coerce")
        # Forward fill missing values
        df = df.ffill()  # Use ffill() instead of fillna(method="ffill")
        # Ensure coordinates are included
        if 'Latitude' in df.columns and 'Longitude' in df.columns:
            df['coordinates'] = df.apply(lambda row: {'lat': row['Latitude'], 'lng': row['Longitude']}, axis=1)
        else:
            df['coordinates'] = None
        return df
    except Exception as e:
        logger.error(f"Error loading and preprocessing data: {e}")
        raise

def train_model(df, features, target):
    """
    Train a linear regression model for a given target variable.
    """
    X = df[features]
    y = df[target]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = LinearRegression()
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    mse = mean_squared_error(y_test, y_pred)
    print(f'\nModel Evaluation for {target}:\nMean Absolute Error (MAE): {mae}\nMean Squared Error (MSE): {mse}')
    return model

def get_predictions(target, start_year, end_year):
    """
    Load the trained model and return predictions for the given target.
    Returns a list of dictionaries containing both actual data and predictions.
    """
    try:
        # Ensure target has the right format for model file lookup
        target_column = target + " (GWh)"  # This is for column name lookup
        model_path = f'{target_column.replace(" ", "_").lower()}_model.pkl'  # Fixed model path format
        
        logger.debug(f"Loading model from {model_path}")
        
        # Try alternative path format if the first one doesn't work
        alternative_model_path = f'{target.replace(" ", "_").lower()}_model.pkl'
        
        # Load data from MongoDB
        df = load_and_preprocess_data()
        
        features = ['Year', 'Population (in millions)', 'Non-Renewable Energy (GWh)']
        logger.debug(f"Using features: {features}")
        
        # Case-insensitive column lookup - find the actual column name that matches
        column_mapping = {}
        for col in df.columns:
            column_mapping[col.lower()] = col
        
        # Find the actual target column name (case-insensitive)
        actual_target_column = None
        for col in df.columns:
            if col.lower() == target_column.lower():
                actual_target_column = col
                break
        
        # Get the latest year in the database
        if 'Year' in df.columns and not df.empty:
            latest_year = df['Year'].max()
            # Get existing data for the requested range
            existing_data = df[(df['Year'] >= start_year) & (df['Year'] <= end_year)].copy()
        else:
            logger.warning("No Year column found or dataframe is empty")
            latest_year = start_year
            existing_data = pd.DataFrame()
        
        existing_data['isPredicted'] = False
        
        # Set 'Predicted Production' to the actual value from the target column
        if actual_target_column and actual_target_column in existing_data.columns:
            existing_data['Predicted Production'] = existing_data[actual_target_column]
            logger.debug(f"Using column {actual_target_column} for target data")
        else:
            logger.warning(f"Target column {target_column} not found in data. Using default value.")
            existing_data['Predicted Production'] = 0
        
        # Convert existing data to list of dicts and remove MongoDB _id
        existing_records = existing_data.drop('_id', axis=1, errors='ignore').to_dict('records')
        
        # Check if we need to make predictions for future years
        predict_start_year = max(start_year, latest_year + 1) if not existing_data.empty else start_year
        
        if predict_start_year > end_year:
            logger.info("No future years to predict in the requested range")
            return existing_records
        
        # Try to load the model
        try:
            # First try the new path format
            try:
                model = joblib.load(model_path)
                logger.info(f"Successfully loaded model from {model_path}")
            except FileNotFoundError:
                # Try the alternative path format
                logger.info(f"Model not found at {model_path}, trying alternative path {alternative_model_path}")
                model = joblib.load(alternative_model_path)
                logger.info(f"Successfully loaded model from {alternative_model_path}")
            
            # Get predictions only for future years
            future_predictions = forecast_production(model, df, features, predict_start_year, end_year)
            
            # Combine results
            result = existing_records + future_predictions
            
        except FileNotFoundError:
            logger.warning(f"Model files not found. Returning only existing data.")
            result = existing_records
        except Exception as e:
            logger.error(f"Error loading or using model: {e}")
            result = existing_records
        
        # Sort by year
        result = sorted(result, key=lambda x: x.get('Year', 0))
        
        logger.debug(f"Returning {len(result)} records")
        return result
    
    except Exception as e:
        logger.error(f"Error in get_predictions: {e}")
        # Return empty list on error to avoid crashes
        return []

def forecast_production(model, df, features, start_year, end_year):
    """
    Forecast future production using the trained model.
    Returns a list of dictionaries with predictions for future years.
    """
    try:
        future_years = pd.DataFrame({'Year': range(start_year, end_year + 1)})
        
        # Calculate growth rates for features we need to project
        avg_population_growth = df['Population (in millions)'].pct_change().mean()
        avg_non_renewable_growth = df['Non-Renewable Energy (GWh)'].pct_change().mean()
        
        # Get the most recent values
        last_population = df['Population (in millions)'].iloc[-1]
        last_non_renewable = df['Non-Renewable Energy (GWh)'].iloc[-1]
        latest_year = df['Year'].iloc[-1]
        
        # Calculate projected values
        future_years['Population (in millions)'] = [
            last_population * (1 + avg_population_growth) ** (year - latest_year)
            for year in future_years['Year']
        ]
        
        future_years['Non-Renewable Energy (GWh)'] = [
            last_non_renewable * (1 + avg_non_renewable_growth) ** (year - latest_year)
            for year in future_years['Year']
        ]
        
        # Project GDP if needed
        if 'Gross Domestic Product' in features:
            if 'Gross Domestic Product' in df.columns and not df['Gross Domestic Product'].empty:
                avg_gdp_growth = df['Gross Domestic Product'].pct_change().mean()
                last_gdp = df['Gross Domestic Product'].iloc[-1]
                future_years['Gross Domestic Product'] = [
                    last_gdp * (1 + avg_gdp_growth) ** (year - latest_year)
                    for year in future_years['Year']
                ]
            else:
                logger.warning("GDP data not available, using default growth rate")
                future_years['Gross Domestic Product'] = [
                    1000 * (1.03) ** (year - latest_year)
                    for year in future_years['Year']
                ]
        
        # Ensure all required features exist
        for feature in features:
            if feature not in future_years.columns:
                future_years[feature] = 1.0  # Default value
                logger.warning(f"Using default value for missing feature: {feature}")
        
        # Make predictions
        future_years['Predicted Production'] = model.predict(future_years[features])
        future_years['isPredicted'] = True
        
        # Convert to list of dictionaries
        predictions = future_years.to_dict('records')
        
        logger.debug(f"Generated {len(predictions)} predictions")
        return predictions
    
    except Exception as e:
        logger.error(f"Error in forecast_production: {e}")
        raise    
    
def train_and_save_models():
    """
    Train and save all prediction models.
    Called by the API to manually trigger model training.
    """
    logger.info("Starting model training process...")
    
    try:
        # Load data from MongoDB
        df = load_and_preprocess_data()
        
        if df.empty:
            logger.error("No data available for training models")
            return {"status": "error", "message": "No data available for training models"}
        
        features = ['Year', 'Population (in millions)', 'Non-Renewable Energy (GWh)']
        targets = ['Geothermal (GWh)', 'Hydro (GWh)', 'Biomass (GWh)', 'Solar (GWh)', 'Wind (GWh)']
        
        # Check if we have the required columns
        missing_columns = [col for col in features + targets if col not in df.columns]
        if missing_columns:
            logger.error(f"Missing required columns for training: {missing_columns}")
            return {
                "status": "error", 
                "message": f"Missing required columns: {missing_columns}",
                "available_columns": list(df.columns)
            }
        
        # Train models
        trained_models = {}
        for target in targets:
            try:
                logger.info(f"Training model for {target}...")
                model = train_model(df, features, target)
                model_path = f'{target.replace(" ", "_").lower()}_model.pkl'
                joblib.dump(model, model_path)
                logger.info(f"Saved model to {model_path}")
                trained_models[target] = "success"
            except Exception as e:
                logger.error(f"Error training model for {target}: {e}")
                trained_models[target] = f"error: {str(e)}"
        
        return {
            "status": "success",
            "message": "Models trained and saved successfully",
            "models": trained_models,
            "data_rows": len(df)
        }
        
    except Exception as e:
        logger.error(f"Error in train_and_save_models: {e}")
        return {"status": "error", "message": str(e)}

def main():
    # Load data from MongoDB
    df = load_and_preprocess_data()
    features = ['Year', 'Population (in millions)', 'Non-Renewable Energy (GWh)']
    targets = ['Geothermal (GWh)', 'Hydro (GWh)', 'Biomass (GWh)', 'Solar (GWh)', 'Wind (GWh)']
    models = {}
    for target in targets:
        model = train_model(df, features, target)
        models[target] = model
        joblib.dump(model, f'{target.replace(" ", "_").lower()}_model.pkl')
    for target in targets:
        model = models[target]
        future_predictions = forecast_production(model, df, features, 2024, 2040)
        print(f"\nFuture Predictions for {target} (2024-2040):")
        print(future_predictions[['Year', 'Predicted Production']])
    
    # get_predictions('biomass')

if __name__ == "_main_":
    main()