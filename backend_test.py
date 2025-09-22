import requests
import sys
import json
from datetime import datetime

class PropertyManagementAPITester:
    def __init__(self, base_url="https://property-fix-7.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.sample_property_id = None
        self.sample_unit_id = None
        self.sample_booking_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, list):
                        print(f"   Response: List with {len(response_data)} items")
                    elif isinstance(response_data, dict):
                        print(f"   Response keys: {list(response_data.keys())}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test API health check"""
        success, response = self.run_test(
            "Health Check",
            "GET",
            "health",
            200
        )
        return success

    def test_root_endpoint(self):
        """Test root API endpoint"""
        success, response = self.run_test(
            "Root Endpoint",
            "GET",
            "",
            200
        )
        return success

    def test_initialize_sample_data(self):
        """Initialize sample data"""
        success, response = self.run_test(
            "Initialize Sample Data",
            "POST",
            "data/initialize",
            200
        )
        return success

    def test_get_properties(self):
        """Test getting all properties"""
        success, response = self.run_test(
            "Get Properties",
            "GET",
            "properties",
            200
        )
        if success and response:
            print(f"   Found {len(response)} properties")
            expected_properties = ["Bura Paradise", "Lily House", "28/12 Maenam Soi 5"]
            found_properties = [p.get('name', '') for p in response]
            print(f"   Property names: {found_properties}")
            
            # Check if expected properties exist
            for expected in expected_properties:
                if expected in found_properties:
                    print(f"   ✅ Found expected property: {expected}")
                else:
                    print(f"   ⚠️  Missing expected property: {expected}")
            
            if response:
                self.sample_property_id = response[0].get('id')
        return success

    def test_get_units(self):
        """Test getting all units"""
        success, response = self.run_test(
            "Get Units",
            "GET",
            "units",
            200
        )
        if success and response:
            print(f"   Found {len(response)} units")
            expected_units = ["Bura1", "Lily1", "Lily2", "MaenamHouse"]
            found_units = [u.get('name', '') for u in response]
            print(f"   Unit names: {found_units}")
            
            # Check if expected units exist
            for expected in expected_units:
                if expected in found_units:
                    print(f"   ✅ Found expected unit: {expected}")
                else:
                    print(f"   ⚠️  Missing expected unit: {expected}")
            
            if response:
                self.sample_unit_id = response[0].get('id')
        return success

    def test_get_bookings(self):
        """Test getting all bookings"""
        success, response = self.run_test(
            "Get Bookings",
            "GET",
            "bookings",
            200
        )
        if success and response:
            print(f"   Found {len(response)} bookings")
            # Look for Arthur booking
            arthur_booking = None
            for booking in response:
                if booking.get('firstName', '').lower() == 'arthur':
                    arthur_booking = booking
                    print(f"   ✅ Found Arthur booking in unit: {booking.get('unitId')}")
                    break
            
            if not arthur_booking:
                print(f"   ⚠️  Arthur booking not found")
            
            if response:
                self.sample_booking_id = response[0].get('id')
        return success

    def test_get_expenses(self):
        """Test getting all expenses"""
        success, response = self.run_test(
            "Get Expenses",
            "GET",
            "expenses",
            200
        )
        if success and response:
            print(f"   Found {len(response)} expenses")
        return success

    def test_create_property(self):
        """Test creating a new property"""
        test_property = {
            "name": f"Test Property {datetime.now().strftime('%H%M%S')}"
        }
        success, response = self.run_test(
            "Create Property",
            "POST",
            "properties",
            200,
            data=test_property
        )
        if success and response:
            self.sample_property_id = response.get('id')
            print(f"   Created property with ID: {self.sample_property_id}")
        return success

    def test_create_unit(self):
        """Test creating a new unit"""
        if not self.sample_property_id:
            print("   ⚠️  No property ID available for unit creation")
            return False
            
        test_unit = {
            "propertyId": self.sample_property_id,
            "name": f"Test Unit {datetime.now().strftime('%H%M%S')}",
            "description": "Test unit description",
            "dailyRate": 500,
            "weeklyRate": 3000,
            "monthlyRate": 9000,
            "monthlyWaterCharge": 200
        }
        success, response = self.run_test(
            "Create Unit",
            "POST",
            "units",
            200,
            data=test_unit
        )
        if success and response:
            self.sample_unit_id = response.get('id')
            print(f"   Created unit with ID: {self.sample_unit_id}")
        return success

    def test_create_booking(self):
        """Test creating a new booking"""
        if not self.sample_unit_id:
            print("   ⚠️  No unit ID available for booking creation")
            return False
            
        test_booking = {
            "unitId": self.sample_unit_id,
            "firstName": "Test",
            "lastName": "Guest",
            "checkIn": "2024-01-01",
            "checkout": "2024-01-31",
            "monthlyRate": 9000,
            "weeklyRate": 3000,
            "dailyRate": 500,
            "deposit": 1000,
            "rentType": "month"
        }
        success, response = self.run_test(
            "Create Booking",
            "POST",
            "bookings",
            200,
            data=test_booking
        )
        if success and response:
            self.sample_booking_id = response.get('id')
            print(f"   Created booking with ID: {self.sample_booking_id}")
        return success

    def test_export_data(self):
        """Test data export"""
        success, response = self.run_test(
            "Export Data",
            "GET",
            "data/export",
            200
        )
        if success and response:
            expected_keys = ['properties', 'units', 'bookings', 'expenses']
            for key in expected_keys:
                if key in response:
                    print(f"   ✅ Export contains {key}: {len(response[key])} items")
                else:
                    print(f"   ❌ Export missing {key}")
        return success

def main():
    print("🏡 Property Management System API Testing")
    print("=" * 50)
    
    # Setup
    tester = PropertyManagementAPITester()
    
    # Run basic connectivity tests
    print("\n📡 CONNECTIVITY TESTS")
    if not tester.test_health_check():
        print("❌ Health check failed, stopping tests")
        return 1
    
    if not tester.test_root_endpoint():
        print("❌ Root endpoint failed, stopping tests")
        return 1

    # Initialize sample data
    print("\n🔧 DATA INITIALIZATION")
    tester.test_initialize_sample_data()

    # Test data retrieval
    print("\n📊 DATA RETRIEVAL TESTS")
    tester.test_get_properties()
    tester.test_get_units()
    tester.test_get_bookings()
    tester.test_get_expenses()

    # Test data creation
    print("\n✏️  DATA CREATION TESTS")
    tester.test_create_property()
    tester.test_create_unit()
    tester.test_create_booking()

    # Test data export
    print("\n📤 DATA EXPORT TESTS")
    tester.test_export_data()

    # Print results
    print(f"\n📊 FINAL RESULTS")
    print("=" * 50)
    print(f"Tests passed: {tester.tests_passed}/{tester.tests_run}")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print(f"⚠️  {tester.tests_run - tester.tests_passed} tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())