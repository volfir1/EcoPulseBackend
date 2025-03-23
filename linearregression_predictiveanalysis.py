# Import necessary libraries
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
MONGO_URI = os.getenv("MONGO_URI")  # Load MongoDB URI from environment variables
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

def forecast_production(model, df, features, start_year, end_year):
    """
    Forecast future production using the trained model.
    Returns a DataFrame with 'Year' and 'Predicted Production'.
    """
    future_years = pd.DataFrame({'Year': range(start_year, end_year + 1)})
    
    # Calculate growth rates for features we need to project
    avg_population_growth = df['Population (in millions)'].pct_change().mean()
    avg_non_renewable_growth = df['Non-Renewable Energy (GWh)'].pct_change().mean()
    
    # Get the most recent values
    last_population = df['Population (in millions)'].iloc[-1]
    last_non_renewable = df['Non-Renewable Energy (GWh)'].iloc[-1]
    
    # Calculate projected values for each feature
    projected_population = [last_population * (1 + avg_population_growth) ** (year - df['Year'].iloc[-1]) for year in future_years['Year']]
    projected_non_renewable = [last_non_renewable * (1 + avg_non_renewable_growth) ** (year - df['Year'].iloc[-1]) for year in future_years['Year']]
    
    # Add projections to future_years DataFrame
    future_years['Population (in millions)'] = projected_population
    future_years['Non-Renewable Energy (GWh)'] = projected_non_renewable
    
    # Project GDP if it's used in the model
    if 'Gross Domestic Product' in df.columns:
        # Calculate GDP growth rate if available
        try:
            avg_gdp_growth = df['Gross Domestic Product'].pct_change().mean()
            last_gdp = df['Gross Domestic Product'].iloc[-1]
            projected_gdp = [last_gdp * (1 + avg_gdp_growth) ** (year - df['Year'].iloc[-1]) for year in future_years['Year']]
            future_years['Gross Domestic Product'] = projected_gdp
        except Exception as e:
            logger.warning(f"Could not project GDP: {e}. Using default values.")
            # Use a default growth rate of 3% if calculation fails
            last_gdp = df['Gross Domestic Product'].iloc[-1] if 'Gross Domestic Product' in df.columns and len(df['Gross Domestic Product']) > 0 else 1000.0
            future_years['Gross Domestic Product'] = [last_gdp * (1.03) ** (year - df['Year'].iloc[-1]) for year in future_years['Year']]
    
    # Make predictions using only the features the model was trained on
    prediction_features = [col for col in features if col in future_years.columns]
    
    # Ensure we have all required features for prediction
    missing_features = [col for col in features if col not in future_years.columns]
    if missing_features:
        logger.warning(f"Missing features for prediction: {missing_features}. Using defaults.")
        # Set default values for missing features
        for feature in missing_features:
            future_years[feature] = 1.0  # Use a default value
    
    # Make the prediction
    future_years['Predicted Production'] = model.predict(future_years[features])
    
    # Preserve the isPredicted flag for existing data
    future_years['isPredicted'] = True  # Default all to predictions
    
    # Override with actual data for years that exist in original dataset
    for year in future_years['Year']:
        if year in df['Year'].values:
            year_data = df[df['Year'] == year]
            # Get index in future_years where Year matches
            idx = future_years[future_years['Year'] == year].index[0]
            
            # Use actual data from original dataset for this year
            future_years.loc[idx, 'isPredicted'] = False
            
            # Update features with actual values where available
            for feature in features:
                if feature in year_data.columns and not pd.isna(year_data[feature].values[0]):
                    future_years.loc[idx, feature] = year_data[feature].values[0]
            
            # If target variable exists in original data, use that instead of prediction
            target_col = None
            for col in df.columns:
                if '(GWh)' in col and 'Non-Renewable' not in col and 'Total' not in col:
                    target_col = col
                    break
            
            if target_col and target_col in year_data.columns:
                future_years.loc[idx, 'Predicted Production'] = year_data[target_col].values[0]
    
    # Include all relevant columns in the output
    output_columns = ['Year', 'Predicted Production', 'isPredicted']
    
    # Include feature columns if they exist
    for feature in features:
        if feature in future_years.columns and feature != 'Year':
            output_columns.append(feature)
    
    return future_years[output_columns]

def get_predictions(target, start_year, end_year):
    """
    Load the trained model and return predictions for the given target.
    """
    try:
        target = target + "_(gwh)"
        model_path = f'{target.replace(" ", "_").lower()}_model.pkl'
        
        # Log the model path
        logger.debug(f"Loading model from {model_path}")
        
        model = joblib.load(model_path)
        
        # Load data from MongoDB
        df = load_and_preprocess_data()
        
        features = ['Year', 'Population (in millions)', 'Non-Renewable Energy (GWh)']
        
        # Log the features
        logger.debug(f"Using features: {features}")
        
        predictions = forecast_production(model, df, features, start_year, end_year)
        
        # Log the predictions
        logger.debug(f"Predictions: {predictions}")
        
        return predictions
    except Exception as e:
        logger.error(f"Error in get_predictions: {e}")
        raise

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

if __name__ == "__main__":
    main()