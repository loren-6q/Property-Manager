from fastapi import FastAPI, HTTPException, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, date
from pathlib import Path
from dotenv import load_dotenv
import os
import uuid
import json
import logging

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI(title="Property Management System", version="1.0.0")

# Create API router
api_router = APIRouter(prefix="/api")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Pydantic Models
class Property(BaseModel):
    id: str = Field(default_factory=lambda: f"prop-{uuid.uuid4().hex[:8]}")
    name: str

class Unit(BaseModel):
    id: str = Field(default_factory=lambda: f"unit-{uuid.uuid4().hex[:8]}")
    propertyId: str
    name: str
    description: str = ""
    internalNotes: str = ""
    dailyRate: float = 0
    weeklyRate: float = 0
    monthlyRate: float = 0
    monthlyWaterCharge: float = 200

class LineItem(BaseModel):
    startDate: datetime
    endDate: datetime
    cost: float
    type: str
    rate: float

class Payment(BaseModel):
    date: str
    amount: float
    category: str = "Rent"

class MeterReading(BaseModel):
    date: str
    reading: float

class Booking(BaseModel):
    id: str = Field(default_factory=lambda: f"book-{uuid.uuid4().hex[:8]}")
    unitId: str
    name: str = ""
    firstName: str
    lastName: str = ""
    source: str = "direct"
    totalPrice: float = 0
    commission: float = 0
    phone: str = ""
    email: str = ""
    whatsapp: str = ""
    instagram: str = ""
    line: str = ""
    facebook: str = ""
    preferredContact: str = "Whatsapp"
    checkIn: str
    checkout: str
    deposit: float = 0
    monthlyRate: float
    weeklyRate: float
    dailyRate: float
    monthlyWaterCharge: float = 200
    electricRate: float = 8
    rentType: str = "month"
    meterReadings: List[MeterReading] = []
    payments: List[Payment] = []
    notes: str = ""
    status: str = "future"
    lineItems: List[LineItem] = []

class Expense(BaseModel):
    id: str = Field(default_factory=lambda: f"expense-{uuid.uuid4().hex[:8]}")
    date: str
    amount: float
    description: str
    category: str = "Repairs"
    propertyId: str = ""
    unitId: str = ""

class Reminder(BaseModel):
    id: str = Field(default_factory=lambda: f"reminder-{uuid.uuid4().hex[:8]}")
    date: str
    text: str
    type: str
    unitId: str = ""
    note: str = ""

# Basic endpoints
@api_router.get("/")
async def root():
    return {"message": "Property Management System API"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "database": "connected"}

# Properties endpoints
@api_router.get("/properties", response_model=List[Property])
async def get_properties():
    try:
        properties = await db.properties.find().to_list(1000)
        return [Property(**prop) for prop in properties]
    except Exception as e:
        logger.error(f"Error fetching properties: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch properties")

@api_router.post("/properties", response_model=Property)
async def create_property(property: Property):
    try:
        await db.properties.insert_one(property.dict())
        return property
    except Exception as e:
        logger.error(f"Error creating property: {e}")
        raise HTTPException(status_code=500, detail="Failed to create property")

@api_router.put("/properties/{property_id}", response_model=Property)
async def update_property(property_id: str, property: Property):
    try:
        property.id = property_id
        await db.properties.replace_one({"id": property_id}, property.dict())
        return property
    except Exception as e:
        logger.error(f"Error updating property: {e}")
        raise HTTPException(status_code=500, detail="Failed to update property")

@api_router.delete("/properties/{property_id}")
async def delete_property(property_id: str):
    try:
        # Delete property
        await db.properties.delete_one({"id": property_id})
        # Delete associated units
        await db.units.delete_many({"propertyId": property_id})
        # Delete associated bookings for units of this property
        units = await db.units.find({"propertyId": property_id}).to_list(1000)
        unit_ids = [unit["id"] for unit in units]
        await db.bookings.delete_many({"unitId": {"$in": unit_ids}})
        # Delete associated expenses
        await db.expenses.delete_many({"propertyId": property_id})
        return {"message": "Property and associated data deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting property: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete property")

# Units endpoints
@api_router.get("/units", response_model=List[Unit])
async def get_units():
    try:
        units = await db.units.find().to_list(1000)
        return [Unit(**unit) for unit in units]
    except Exception as e:
        logger.error(f"Error fetching units: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch units")

@api_router.post("/units", response_model=Unit)
async def create_unit(unit: Unit):
    try:
        await db.units.insert_one(unit.dict())
        return unit
    except Exception as e:
        logger.error(f"Error creating unit: {e}")
        raise HTTPException(status_code=500, detail="Failed to create unit")

@api_router.put("/units/{unit_id}", response_model=Unit)
async def update_unit(unit_id: str, unit: Unit):
    try:
        unit.id = unit_id
        await db.units.replace_one({"id": unit_id}, unit.dict())
        return unit
    except Exception as e:
        logger.error(f"Error updating unit: {e}")
        raise HTTPException(status_code=500, detail="Failed to update unit")

@api_router.delete("/units/{unit_id}")
async def delete_unit(unit_id: str):
    try:
        # Delete unit
        await db.units.delete_one({"id": unit_id})
        # Delete associated bookings
        await db.bookings.delete_many({"unitId": unit_id})
        # Delete associated expenses
        await db.expenses.delete_many({"unitId": unit_id})
        return {"message": "Unit and associated data deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting unit: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete unit")

# Bookings endpoints
@api_router.get("/bookings", response_model=List[Booking])
async def get_bookings():
    try:
        bookings = await db.bookings.find().to_list(1000)
        return [Booking(**booking) for booking in bookings]
    except Exception as e:
        logger.error(f"Error fetching bookings: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch bookings")

@api_router.post("/bookings", response_model=Booking)
async def create_booking(booking: Booking):
    try:
        await db.bookings.insert_one(booking.dict())
        return booking
    except Exception as e:
        logger.error(f"Error creating booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to create booking")

@api_router.put("/bookings/{booking_id}", response_model=Booking)
async def update_booking(booking_id: str, booking: Booking):
    try:
        booking.id = booking_id
        await db.bookings.replace_one({"id": booking_id}, booking.dict())
        return booking
    except Exception as e:
        logger.error(f"Error updating booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to update booking")

@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str):
    try:
        await db.bookings.delete_one({"id": booking_id})
        return {"message": "Booking deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete booking")

# Expenses endpoints
@api_router.get("/expenses", response_model=List[Expense])
async def get_expenses():
    try:
        expenses = await db.expenses.find().to_list(1000)
        return [Expense(**expense) for expense in expenses]
    except Exception as e:
        logger.error(f"Error fetching expenses: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch expenses")

@api_router.post("/expenses", response_model=Expense)
async def create_expense(expense: Expense):
    try:
        await db.expenses.insert_one(expense.dict())
        return expense
    except Exception as e:
        logger.error(f"Error creating expense: {e}")
        raise HTTPException(status_code=500, detail="Failed to create expense")

@api_router.put("/expenses/{expense_id}", response_model=Expense)
async def update_expense(expense_id: str, expense: Expense):
    try:
        expense.id = expense_id
        await db.expenses.replace_one({"id": expense_id}, expense.dict())
        return expense
    except Exception as e:
        logger.error(f"Error updating expense: {e}")
        raise HTTPException(status_code=500, detail="Failed to update expense")

@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str):
    try:
        await db.expenses.delete_one({"id": expense_id})
        return {"message": "Expense deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting expense: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete expense")

# Data management endpoints
@api_router.post("/data/import")
async def import_data(data: Dict[str, Any]):
    try:
        # Clear existing data
        await db.properties.delete_many({})
        await db.units.delete_many({})
        await db.bookings.delete_many({})
        await db.expenses.delete_many({})
        
        # Import new data
        if "properties" in data:
            await db.properties.insert_many(data["properties"])
        if "units" in data:
            await db.units.insert_many(data["units"])
        if "bookings" in data:
            await db.bookings.insert_many(data["bookings"])
        if "expenses" in data:
            await db.expenses.insert_many(data["expenses"])
            
        return {"message": "Data imported successfully"}
    except Exception as e:
        logger.error(f"Error importing data: {e}")
        raise HTTPException(status_code=500, detail="Failed to import data")

@api_router.get("/data/export")
async def export_data():
    try:
        properties = await db.properties.find().to_list(1000)
        units = await db.units.find().to_list(1000)
        bookings = await db.bookings.find().to_list(1000)
        expenses = await db.expenses.find().to_list(1000)
        
        # Remove MongoDB ObjectId fields to avoid serialization issues
        for item in properties + units + bookings + expenses:
            if '_id' in item:
                del item['_id']
        
        return {
            "properties": properties,
            "units": units,
            "bookings": bookings,
            "expenses": expenses
        }
    except Exception as e:
        logger.error(f"Error exporting data: {e}")
        raise HTTPException(status_code=500, detail="Failed to export data")

@api_router.post("/data/initialize")
async def initialize_sample_data():
    """Initialize with sample data from the original Firebase app"""
    try:
        # Check if data already exists
        existing_properties = await db.properties.count_documents({})
        if existing_properties > 0:
            return {"message": "Data already exists"}
        
        # Sample data (from the original Firebase app)
        sample_properties = [
            {"id": "prop-1", "name": "Bura Paradise"},
            {"id": "prop-2", "name": "Lily House"},
            {"id": "prop-3", "name": "28/12 Maenam Soi 5"}
        ]
        
        sample_units = [
            {"id": "unit-1", "propertyId": "prop-3", "name": "MaenamHouse", "description": "3 bedroom, 2 bathroom house with yard", "internalNotes": "", "dailyRate": 500, "weeklyRate": 3000, "monthlyRate": 15000, "monthlyWaterCharge": 200},
            {"id": "unit-2", "propertyId": "prop-1", "name": "Bura1", "description": "Studio apartment", "internalNotes": "", "dailyRate": 500, "weeklyRate": 3000, "monthlyRate": 9000, "monthlyWaterCharge": 200},
            {"id": "unit-3", "propertyId": "prop-2", "name": "Lily1", "description": "Small apartment, bathroom on balcony, fake staircase", "internalNotes": "", "dailyRate": 500, "weeklyRate": 3000, "monthlyRate": 7500, "monthlyWaterCharge": 200},
            {"id": "unit-4", "propertyId": "prop-2", "name": "Lily2", "description": "Large apartment", "internalNotes": "", "dailyRate": 500, "weeklyRate": 3000, "monthlyRate": 9500, "monthlyWaterCharge": 200},
            {"id": "unit-5", "propertyId": "prop-2", "name": "Lily3", "description": "Large apartment", "internalNotes": "", "dailyRate": 500, "weeklyRate": 3000, "monthlyRate": 9000, "monthlyWaterCharge": 200}
        ]
        
        # Insert sample data
        await db.properties.insert_many(sample_properties)
        await db.units.insert_many(sample_units)
        
        return {"message": "Sample data initialized successfully"}
    except Exception as e:
        logger.error(f"Error initializing sample data: {e}")
        raise HTTPException(status_code=500, detail="Failed to initialize sample data")

# Include the router in the main app
app.include_router(api_router)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)