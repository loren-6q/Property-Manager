import React, { useState, useEffect } from "react";
import { format, differenceInDays, parseISO, addMonths, addWeeks, subDays, isBefore, isAfter, isSameDay, addDays, differenceInMonths, addYears, eachDayOfInterval } from "date-fns";
import axios from "axios";
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import "./App.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Utility Functions and Data
const STATUS_COLORS = {
  future: "bg-yellow-100 border-yellow-500",
  paid: "bg-green-100 border-green-500",
  owed: "bg-red-100 border-red-500",
  vacant: "bg-yellow-100 border-yellow-500",
  occupiedPaid: "bg-green-100 border-green-700",
  occupiedOwes: "bg-red-100 border-red-700",
  checkedOutPaid: "bg-gray-200 border-gray-500",
  checkedOutOwes: "bg-orange-200 border-orange-500",
  canceled: "bg-gray-400 border-gray-700",
};

const getMeterCost = (meterReadings, rate = 8) => {
  if (!meterReadings || meterReadings.length < 2) return 0;
  const firstReading = meterReadings[0].reading;
  const lastReading = meterReadings[meterReadings.length - 1].reading;
  const kwhUsed = lastReading - firstReading;
  return Math.max(0, kwhUsed * rate);
};

const getRentCost = (booking) => {
  if (booking.totalPrice && booking.totalPrice > 0) {
    // If totalPrice is available, use it as the total rent
    return booking.totalPrice - (booking.commission || 0);
  }
  // Otherwise, calculate from line items
  return booking.lineItems ? booking.lineItems.reduce((sum, item) => sum + item.cost, 0) : 0;
};

const getWaterCost = (booking) => {
  if (!booking.checkIn || !booking.checkout) return 0;
  try {
    const checkInDate = typeof booking.checkIn === 'string' ? parseISO(booking.checkIn) : new Date(booking.checkIn);
    const checkoutDate = typeof booking.checkout === 'string' ? parseISO(booking.checkout) : new Date(booking.checkout);
    const numMonths = differenceInMonths(checkoutDate, checkInDate);
    let waterCost = numMonths * booking.monthlyWaterCharge;
    const remainingDays = differenceInDays(checkoutDate, addMonths(checkInDate, numMonths));
    if (remainingDays >= 28) {
      waterCost += booking.monthlyWaterCharge;
    }
    return waterCost;
  } catch (error) {
    console.error('Error calculating water cost:', error);
    return 0;
  }
};

const getTotalCost = (booking) => {
  const totalRent = getRentCost(booking);
  const totalElectric = getMeterCost(booking.meterReadings, booking.electricRate);
  const totalWater = getWaterCost(booking);
  // Don't include deposit in total cost - it's separate
  return totalRent + totalElectric + totalWater;
};

const getAmountPaid = (payments) => payments.reduce((sum, p) => sum + p.amount, 0);

const getRentPaid = (payments) => payments.filter(p => p.category !== 'Deposit').reduce((sum, p) => sum + p.amount, 0);

const getAmountDue = (booking) => {
  const totalCost = getTotalCost(booking);
  const rentPaid = getRentPaid(booking.payments); // Exclude deposit payments
  return totalCost - rentPaid;
};

const getDueNowRent = (booking) => {
  const today = new Date();
  try {
    const checkInDate = typeof booking.checkIn === 'string' ? parseISO(booking.checkIn) : new Date(booking.checkIn);

    if (isAfter(checkInDate, today)) {
      return 0;
    }

    if (booking.totalPrice && booking.totalPrice > 0) {
      return booking.totalPrice - (booking.commission || 0);
    }
      
    return booking.lineItems
      .filter(item => {
        const itemStartDate = typeof item.startDate === 'string' ? parseISO(item.startDate) : new Date(item.startDate);
        return isBefore(itemStartDate, today) || isSameDay(itemStartDate, today);
      })
      .reduce((sum, item) => sum + item.cost, 0);
  } catch (error) {
    console.error('Error calculating due now rent:', error);
    return 0;
  }
};

const getDueNow = (booking) => {
  const today = new Date();
  try {
    const checkInDate = typeof booking.checkIn === 'string' ? parseISO(booking.checkIn) : new Date(booking.checkIn);

    if (isAfter(checkInDate, today)) {
      return 0;
    }
    const rentDueNow = getDueNowRent(booking);
    let waterDueNow = 0;
    const numMonthsPassed = differenceInMonths(today, checkInDate);
    waterDueNow = numMonthsPassed * (booking.monthlyWaterCharge || 0);
    const electricDueNow = getMeterCost(booking.meterReadings, booking.electricRate);

    // Don't include deposit in dues - it's separate
    const totalDue = rentDueNow + electricDueNow + waterDueNow;

    return totalDue;
  } catch (error) {
    console.error('Error calculating due now:', error);
    return 0;
  }
};

const getNextPaymentDueDate = (booking) => {
  const checkInDate = parseISO(booking.checkIn);
  const today = new Date();
  let nextDate = checkInDate;
  while (isBefore(nextDate, today) || isSameDay(nextDate, today)) {
    if (booking.rentType === 'day') {
      nextDate = addDays(nextDate, 1);
    } else if (booking.rentType === 'week') {
      nextDate = addWeeks(nextDate, 1);
    } else if (booking.rentType === 'month') {
      nextDate = addMonths(nextDate, 1);
    } else {
      break;
    }
  }
  return format(nextDate, 'MMM d, yyyy');
};

const getNextCheckInDate = (unitId, bookings) => {
  const today = new Date();
  const futureBookings = bookings
    .filter(b => b.unitId === unitId && isAfter(parseISO(b.checkIn), today))
    .sort((a, b) => differenceInDays(parseISO(a.checkIn), parseISO(b.checkIn)));
  return futureBookings.length > 0 ? {
    name: futureBookings[0].name,
    checkIn: format(parseISO(futureBookings[0].checkIn), 'MMM d, yyyy'),
    id: futureBookings[0].id
  } : null;
};

const getDisplayRate = (booking) => {
  const numDays = differenceInDays(parseISO(booking.checkout), parseISO(booking.checkIn));
  if (numDays < 7) {
    return `${booking.dailyRate}฿/day`;
  } else if (numDays < 21) {
    return `${booking.weeklyRate}฿/wk`;
  } else {
    return `${booking.monthlyRate}฿/mo`;
  }
};

const calculateLineItems = (startDateStr, endDateStr, dailyRate, weeklyRate, monthlyRate) => {
  let lineItems = [];
  if (!startDateStr || !endDateStr) return lineItems;
  
  try {
    let current = typeof startDateStr === 'string' ? parseISO(startDateStr) : new Date(startDateStr);
    const end = typeof endDateStr === 'string' ? parseISO(endDateStr) : new Date(endDateStr);

    if (!isAfter(end, current)) {
      return lineItems;
    }

    while (isBefore(current, end)) {
      let itemStartDate = current;
      let itemEndDate;
      let cost;
      let type;
      let nextDate;

      const endOfMonth = subDays(addMonths(itemStartDate, 1), 1);
      
      // Check if this period qualifies for monthly rate (-3 to +2 days flexibility)
      const daysInPeriod = differenceInDays(isAfter(endOfMonth, end) ? end : addDays(endOfMonth, 1), itemStartDate);
      const daysInMonth = differenceInDays(addDays(endOfMonth, 1), itemStartDate);
      const daysDifference = Math.abs(daysInPeriod - daysInMonth);
      
      if (daysDifference <= 5 && daysInPeriod >= (daysInMonth - 3)) {
        // Use monthly rate if within -3 to +2 days of full month
        itemEndDate = isAfter(endOfMonth, end) ? end : endOfMonth;
        cost = monthlyRate;
        type = "month";
        nextDate = addDays(itemEndDate, 1);
        lineItems.push({ startDate: itemStartDate, endDate: itemEndDate, cost, type, rate: monthlyRate });
        current = nextDate;
      } else if (isAfter(endOfMonth, end) || isSameDay(endOfMonth, end)) {
        const remainingDays = differenceInDays(end, itemStartDate);
        const numWeeks = Math.floor(remainingDays / 7);
        const remDays = remainingDays % 7;

        if (numWeeks > 0) {
          itemEndDate = subDays(addWeeks(itemStartDate, numWeeks), 1);
          cost = numWeeks * weeklyRate;
          type = "week";
          lineItems.push({ startDate: itemStartDate, endDate: itemEndDate, cost, type, rate: weeklyRate });
          current = addWeeks(itemStartDate, numWeeks);
        }
        if (remDays > 0) {
          itemStartDate = current;
          itemEndDate = end;
          cost = remDays * dailyRate;
          type = "day";
          lineItems.push({ startDate: itemStartDate, endDate: itemEndDate, cost, type, rate: dailyRate });
          current = end;
        }
        break;
      } else {
        itemEndDate = endOfMonth;
        cost = monthlyRate;
        type = "month";
        nextDate = addDays(endOfMonth, 1);
        lineItems.push({ startDate: itemStartDate, endDate: itemEndDate, cost, type, rate: monthlyRate });
        current = nextDate;
      }
    }
  } catch (error) {
    console.error('Error calculating line items:', error);
  }
  return lineItems;
};

function App() {
  const today = new Date();
  const [activeTab, setActiveTab] = useState("units");
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [modalData, setModalData] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });
  const [meterRate, setMeterRate] = useState(8);
  const [accountingFilters, setAccountingFilters] = useState({ unitId: 'all', guestName: '', checkInMonth: 'all', checkoutMonth: 'all', owedStatus: 'all' });
  const [isFontSizeIncreased, setIsFontSizeIncreased] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [newReminderData, setNewReminderData] = useState({ date: format(today, 'yyyy-MM-dd'), unitId: '', note: '', type: 'Custom' });
  const [isRemindersModalOpen, setIsRemindersModalOpen] = useState(false);
  const [expandedProperties, setExpandedProperties] = useState(new Set());
  const [isRentBreakdownExpanded, setIsRentBreakdownExpanded] = useState(false);
  const [isElectricBreakdownExpanded, setIsElectricBreakdownExpanded] = useState(false);
  const [isWaterBreakdownExpanded, setIsWaterBreakdownExpanded] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [newExpense, setNewExpense] = useState({ date: format(today, 'yyyy-MM-dd'), amount: 0, description: '', category: 'Repairs', propertyId: '', unitId: '' });
  const [accountingPeriod, setAccountingPeriod] = useState({ year: format(today, 'yyyy'), month: 'all' });
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
  const [newProperty, setNewProperty] = useState({ name: '' });
  const [isPropertyEditModalOpen, setIsPropertyEditModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const chronologicalMonths = ["all", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // API Functions
  const fetchData = async () => {
    try {
      setLoading(true);
      const [propertiesRes, unitsRes, bookingsRes, expensesRes] = await Promise.all([
        axios.get(`${API}/properties`),
        axios.get(`${API}/units`),
        axios.get(`${API}/bookings`),
        axios.get(`${API}/expenses`)
      ]);

      setProperties(propertiesRes.data);
      setUnits(unitsRes.data);
      setBookings(bookingsRes.data);
      setExpenses(expensesRes.data);
    } catch (error) {
      console.error("Error fetching data:", error);
      handleShowAlert("Failed to load data. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const initializeSampleData = async () => {
    try {
      await axios.post(`${API}/data/initialize`);
      await fetchData();
      handleShowAlert("Sample data initialized!");
    } catch (error) {
      console.error("Error initializing data:", error);
      handleShowAlert("Failed to initialize sample data.");
    }
  };

  useEffect(() => {
    const initApp = async () => {
      try {
        // Check if API is available
        await axios.get(`${API}/health`);
        await fetchData();
        
        // If no data exists, initialize sample data
        if (properties.length === 0) {
          await initializeSampleData();
        }
      } catch (error) {
        console.error("Error initializing app:", error);
        handleShowAlert("Failed to connect to server. Please try again.");
      }
    };
    
    initApp();
  }, []);

  // Generate reminders based on bookings
  useEffect(() => {
    if (!loading && units.length > 0 && bookings.length > 0) {
      const today = new Date();
      const oneMonthFromNow = addMonths(today, 1);
      
      const newReminders = [];
      
      // Check for vacant units today
      const vacantUnitsToday = units.filter(unit => {
        const isOccupiedToday = bookings.some(b => 
          b.unitId === unit.id && 
          isBefore(parseISO(b.checkIn), addDays(today, 1)) && 
          isAfter(parseISO(b.checkout), today)
        );
        return !isOccupiedToday;
      });

      vacantUnitsToday.forEach(unit => {
        newReminders.push({
          type: 'vacant',
          date: today,
          text: `${unit.name}: VACANT Today`,
          unitId: unit.id,
          note: 'This unit is currently vacant.'
        });
      });

      // Generate reminders for upcoming events
      units.forEach(unit => {
        const bookingsForUnit = bookings.filter(b => b.unitId === unit.id).sort((a, b) => parseISO(a.checkIn) - parseISO(b.checkIn));
        
        bookingsForUnit.forEach(b => {
          const checkInDate = parseISO(b.checkIn);
          const checkoutDate = parseISO(b.checkout);
          
          if (isAfter(checkInDate, today) && isBefore(checkInDate, oneMonthFromNow)) {
            newReminders.push({
              type: 'checkin',
              date: checkInDate,
              text: `${unit.name}: Check-in ${b.firstName}`,
              unitId: b.unitId,
              note: ''
            });
          }
          
          if (isAfter(checkoutDate, today) && isBefore(checkoutDate, oneMonthFromNow)) {
            newReminders.push({
              type: 'checkout',
              date: checkoutDate,
              text: `${unit.name}: Checkout ${b.firstName}`,
              unitId: b.unitId,
              note: ''
            });
          }
          
          // Monthly rent reminders
          let nextRentDate = addMonths(checkInDate, 1);
          while (isBefore(nextRentDate, checkoutDate)) {
            if (isAfter(nextRentDate, today) && isBefore(nextRentDate, oneMonthFromNow)) {
              newReminders.push({
                type: 'rent',
                date: nextRentDate,
                text: `${unit.name}: Rent due ${b.monthlyRate}฿`,
                unitId: b.unitId,
                note: ''
              });
            }
            nextRentDate = addMonths(nextRentDate, 1);
          }
        });
      });
      
      setReminders(newReminders);
    }
  }, [bookings, units, loading]);

  const getDaysDuration = (startDate, endDate) => {
    if (!startDate || !endDate) return "";
    try {
      const start = typeof startDate === 'string' ? parseISO(startDate) : new Date(startDate);
      const end = typeof endDate === 'string' ? parseISO(endDate) : new Date(endDate);
      if (!start || !end || isAfter(start, end)) return "";
      const months = differenceInMonths(end, start);
      const remainingDaysAfterMonths = differenceInDays(end, addMonths(start, months));
      const weeks = Math.floor(remainingDaysAfterMonths / 7);
      const days = remainingDaysAfterMonths % 7;
      return `${months}m ${weeks}w ${days}d`;
    } catch (error) {
      console.error('Error calculating duration:', error);
      return "";
    }
  };

  const saveData = async () => {
    try {
      const response = await axios.get(`${API}/data/export`);
      const data = response.data;
      
      const dataStr = JSON.stringify(data, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const link = document.createElement("a");
      link.setAttribute("href", URL.createObjectURL(blob));
      link.setAttribute("download", `pms_data_${format(new Date(), 'yyyy-MM-dd')}.json`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      handleShowAlert('All data exported as JSON!');
    } catch (error) {
      console.error("Error exporting data:", error);
      handleShowAlert('Failed to export data.');
    }
  };

  const loadData = async (e) => {
    const file = e.target.files[0];
    if (!file) {
      return;
    }

    const fileExtension = file.name.split('.').pop().toLowerCase();
    
    if (fileExtension === 'csv') {
      // Handle CSV import
      Papa.parse(file, {
        header: true,
        complete: async (results) => {
          try {
            const csvData = results.data.filter(row => row.Name && row.Name.trim() !== '');
            
            // Convert CSV to booking format
            const importedBookings = csvData.map(row => ({
              id: `book-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              unitId: units.find(u => u.name === row['Unit'])?.id || 'unit-1',
              name: row['Name'] || '',
              firstName: row['First Name'] || row['Name'] || '',
              lastName: row['Last Name'] || '',
              source: row['Source'] || 'direct',
              totalPrice: parseFloat(row['Total Price']) || 0,
              commission: parseFloat(row['Commission']) || 0,
              checkIn: row['Check-in'] || format(new Date(), 'yyyy-MM-dd'),
              checkout: row['Checkout'] || format(addMonths(new Date(), 1), 'yyyy-MM-dd'),
              deposit: parseFloat(row['Deposit']) || 0,
              monthlyRate: parseFloat(row['Monthly Rate']) || 9000,
              weeklyRate: parseFloat(row['Weekly Rate']) || 3000,
              dailyRate: parseFloat(row['Daily Rate']) || 500,
              monthlyWaterCharge: 200,
              electricRate: 8,
              phone: row['Phone'] || '',
              email: row['Email'] || '',
              whatsapp: row['WhatsApp'] || '',
              line: row['LINE'] || '',
              instagram: row['Instagram'] || '',
              facebook: row['Facebook'] || '',
              preferredContact: row['Preferred Contact'] || 'Phone',
              meterReadings: [],
              payments: [],
              notes: row['Notes'] || '',
              status: row['Status'] || 'future',
              lineItems: []
            }));

            // Calculate line items for each booking
            importedBookings.forEach(booking => {
              booking.lineItems = calculateLineItems(
                booking.checkIn, 
                booking.checkout, 
                booking.dailyRate, 
                booking.weeklyRate, 
                booking.monthlyRate
              );
            });

            // Save to backend
            for (const booking of importedBookings) {
              await axios.post(`${API}/bookings`, booking);
            }

            await fetchData();
            handleShowAlert(`Successfully imported ${importedBookings.length} bookings from CSV!`);
          } catch (error) {
            console.error("Error importing CSV:", error);
            handleShowAlert('Error importing CSV. Please check the format and try again.');
          }
        },
        error: (error) => {
          console.error("CSV parsing error:", error);
          handleShowAlert('Error parsing CSV file. Please ensure it\'s a valid CSV format.');
        }
      });
    } else {
      // Handle JSON import (existing code)
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const importedData = JSON.parse(event.target.result);
          if (importedData && importedData.properties && importedData.units) {
            await axios.post(`${API}/data/import`, importedData);
            await fetchData();
            handleShowAlert('Data loaded successfully!');
          } else {
            handleShowAlert('Invalid data format in file.');
          }
        } catch (e) {
          console.error("Error loading data:", e);
          handleShowAlert('Error loading data. Please ensure the file is a valid JSON export.');
        }
      };
      reader.readAsText(file);
    }
  };
    
  const toggleFontSize = () => {
    setIsFontSizeIncreased(!isFontSizeIncreased);
  };

  const handleShowAlert = (message) => {
    setAlertMessage(message);
    setTimeout(() => {
      setAlertMessage(null);
    }, 5000);
  };
    
  const isOverlap = (newBooking, existingBookings) => {
    const newStart = parseISO(newBooking.checkIn);
    const newEnd = parseISO(newBooking.checkout);
    if (!newStart || !newEnd || isAfter(newStart, newEnd)) return true;
    return existingBookings.some(b => {
      if (newBooking.id && b.id === newBooking.id) return false;
      const existingStart = parseISO(b.checkIn);
      const existingEnd = parseISO(b.checkout);
      return (newStart < existingEnd) && (newEnd > existingStart);
    });
  };

  const getUnitStatus = (unitId) => {
    const allBookingsForUnit = bookings.filter(b => b.unitId === unitId);
    const currentBooking = allBookingsForUnit.find(b => isBefore(parseISO(b.checkIn), today) && isAfter(parseISO(b.checkout), today));
    const nextBooking = getNextCheckInDate(unitId, allBookingsForUnit);
    if (currentBooking) {
      const amountDue = getDueNow(currentBooking) - getRentPaid(currentBooking.payments);
      return amountDue > 2 ? 'occupiedOwes' : 'occupiedPaid';
    } else if (nextBooking) {
      return 'future';
    } else {
      return 'vacant';
    }
  };

  const handleOpenBookingModal = (booking = null, unitId = null) => {
    let newBookingData;
    if (booking) {
      newBookingData = booking;
    } else if (unitId) {
      const unit = units.find(u => u.id === unitId);
      newBookingData = {
        id: `book-${Date.now()}`, unitId, name: "", firstName: "", lastName: "", source: 'direct', totalPrice: 0, commission: 0,
        phone: "", email: "", whatsapp: "", instagram: "", line: "", facebook: "", preferredContact: "Whatsapp",
        checkIn: format(today, "yyyy-MM-dd"), checkout: format(addMonths(today, 1), "yyyy-MM-dd"),
        deposit: 0,
        monthlyRate: unit.monthlyRate,
        weeklyRate: unit.weeklyRate,
        dailyRate: unit.dailyRate,
        monthlyWaterCharge: 200,
        electricRate: 8,
        rentType: "month",
        meterReadings: [],
        payments: [],
        notes: "",
        status: "future",
        lineItems: [],
      };
    }
    if (newBookingData) {
      newBookingData.lineItems = calculateLineItems(newBookingData.checkIn, newBookingData.checkout, newBookingData.dailyRate, newBookingData.weeklyRate, newBookingData.monthlyRate);
    }
    setModalData(newBookingData);
    setIsModalOpen(true);
  };

  const handleSaveModal = async () => {
    if (!modalData.firstName || !modalData.checkIn || !modalData.checkout) {
      handleShowAlert("First name, check-in, and checkout dates are required.");
      return;
    }
    const otherBookings = bookings.filter(b => b.unitId === modalData.unitId);
    if (isOverlap(modalData, otherBookings)) {
      handleShowAlert("This booking overlaps with an existing one. Please choose different dates.");
      return;
    }
    const updatedBooking = {
      ...modalData,
      name: `${modalData.firstName} ${modalData.lastName}`.trim(),
    };
    try {
      if (bookings.find(b => b.id === updatedBooking.id)) {
        await axios.put(`${API}/bookings/${updatedBooking.id}`, updatedBooking);
      } else {
        await axios.post(`${API}/bookings`, updatedBooking);
      }
      await fetchData();
      handleShowAlert("Booking saved successfully!");
      handleCloseModal();
    } catch (e) {
      console.error("Error saving booking:", e);
      handleShowAlert("Failed to save booking. Please try again.");
    }
  };
    
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalData(null);
  };

  const handleOpenUnitModal = (unit) => {
    setEditingUnit(unit);
    setIsUnitModalOpen(true);
  };
    
  const handleSaveUnit = async () => {
    try {
      if (units.find(u => u.id === editingUnit.id)) {
        await axios.put(`${API}/units/${editingUnit.id}`, editingUnit);
      } else {
        await axios.post(`${API}/units`, editingUnit);
      }
      await fetchData();
      handleShowAlert("Unit saved successfully!");
      setIsUnitModalOpen(false);
      setEditingUnit(null);
    } catch (e) {
      console.error("Error saving unit:", e);
      handleShowAlert("Failed to save unit. Please try again.");
    }
  };

  const handleDeleteProperty = async (propertyId) => {
    setConfirmMessage('Are you sure you want to delete this property and all its units and bookings? This cannot be undone.');
    setConfirmAction(() => async () => {
      try {
        await axios.delete(`${API}/properties/${propertyId}`);
        await fetchData();
        handleShowAlert('Property and all associated data deleted.');
        setIsConfirmModalOpen(false);
      } catch (e) {
        console.error("Error deleting property:", e);
        handleShowAlert("Failed to delete property. Please try again.");
        setIsConfirmModalOpen(false);
      }
    });
    setIsConfirmModalOpen(true);
  };

  const handleOpenPropertyEditModal = (property) => {
    setEditingProperty({
      ...property,
      address: property.address || '',
      wifiPassword: property.wifiPassword || '',
      electricAccount: property.electricAccount || '',
      waterAccount: property.waterAccount || '',
      internetAccount: property.internetAccount || '',
      rentAmount: property.rentAmount || '',
      rentPaymentDetails: property.rentPaymentDetails || '',
      contactInfo: property.contactInfo || '',
      unitsCount: property.unitsCount || units.filter(u => u.propertyId === property.id).length,
      description: property.description || ''
    });
    setIsPropertyEditModalOpen(true);
  };

  const handleSaveProperty = async () => {
    try {
      if (editingProperty.id) {
        await axios.put(`${API}/properties/${editingProperty.id}`, editingProperty);
        handleShowAlert('Property updated successfully!');
      }
      await fetchData();
      setIsPropertyEditModalOpen(false);
      setEditingProperty(null);
    } catch (error) {
      console.error('Error saving property:', error);
      handleShowAlert('Failed to save property. Please try again.');
    }
  };

  const getLastMeterReading = (unitId, currentBookingId) => {
    // Find all previous bookings for this unit (excluding current booking)
    const previousBookings = bookings
      .filter(b => b.unitId === unitId && b.id !== currentBookingId)
      .sort((a, b) => parseISO(b.checkout) - parseISO(a.checkout)); // Sort by checkout date, newest first
    
    // Find the most recent booking with meter readings
    for (const booking of previousBookings) {
      if (booking.meterReadings && booking.meterReadings.length > 0) {
        const sortedReadings = booking.meterReadings.sort((a, b) => new Date(b.date) - new Date(a.date));
        return sortedReadings[0].reading; // Return the last (most recent) reading
      }
    }
    return null;
  };

  const handleAutoFillMeterReading = () => {
    const lastReading = getLastMeterReading(modalData.unitId, modalData.id);
    if (lastReading !== null) {
      const input = document.getElementById("newMeterReading");
      input.value = lastReading;
      handleShowAlert(`Auto-filled with last reading: ${lastReading}`);
    } else {
      handleShowAlert('No previous meter readings found for this unit.');
    }
  };

  const moveProperty = async (propertyId, direction) => {
    const propertyIndex = properties.findIndex(p => p.id === propertyId);
    if (propertyIndex === -1) return;

    const newIndex = direction === 'up' ? propertyIndex - 1 : propertyIndex + 1;
    if (newIndex < 0 || newIndex >= properties.length) return;

    // Create new array with swapped positions
    const newProperties = [...properties];
    [newProperties[propertyIndex], newProperties[newIndex]] = [newProperties[newIndex], newProperties[propertyIndex]];
    
    // Update the order field for both properties
    newProperties[propertyIndex].order = propertyIndex;
    newProperties[newIndex].order = newIndex;

    try {
      await axios.put(`${API}/properties/${newProperties[propertyIndex].id}`, { order: propertyIndex });
      await axios.put(`${API}/properties/${newProperties[newIndex].id}`, { order: newIndex });
      await fetchData();
      handleShowAlert('Property order updated successfully!');
    } catch (error) {
      console.error('Error updating property order:', error);
      handleShowAlert('Failed to update property order.');
    }
  };

  const moveUnit = async (unitId, direction) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    const unitsInProperty = units.filter(u => u.propertyId === unit.propertyId);
    const unitIndex = unitsInProperty.findIndex(u => u.id === unitId);
    
    const newIndex = direction === 'up' ? unitIndex - 1 : unitIndex + 1;
    if (newIndex < 0 || newIndex >= unitsInProperty.length) return;

    // Create new array with swapped positions
    const newUnits = [...unitsInProperty];
    [newUnits[unitIndex], newUnits[newIndex]] = [newUnits[newIndex], newUnits[unitIndex]];
    
    // Update the order field for both units
    newUnits[unitIndex].order = unitIndex;
    newUnits[newIndex].order = newIndex;

    try {
      await axios.put(`${API}/units/${newUnits[unitIndex].id}`, { order: unitIndex });
      await axios.put(`${API}/units/${newUnits[newIndex].id}`, { order: newIndex });
      await fetchData();
      handleShowAlert('Unit order updated successfully!');
    } catch (error) {
      console.error('Error updating unit order:', error);
      handleShowAlert('Failed to update unit order.');
    }
  };

  const handleDeleteUnit = async (unitId) => {
    setConfirmMessage('Are you sure you want to delete this unit and all its bookings? This cannot be undone.');
    setConfirmAction(() => async () => {
      try {
        await axios.delete(`${API}/units/${unitId}`);
        await fetchData();
        handleShowAlert('Unit and all associated data deleted.');
        setIsConfirmModalOpen(false);
      } catch (e) {
        console.error("Error deleting unit:", e);
        handleShowAlert("Failed to delete unit. Please try again.");
        setIsConfirmModalOpen(false);
      }
    });
    setIsConfirmModalOpen(true);
  };

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedBookings = () => {
    let filtered = bookings;
    const { unitId, guestName, checkInMonth, checkoutMonth, owedStatus } = accountingFilters;

    if (unitId !== 'all') {
      filtered = filtered.filter(b => b.unitId === unitId);
    }
    if (guestName) {
      filtered = filtered.filter(b =>
        b.firstName.toLowerCase().includes(guestName.toLowerCase()) ||
        b.lastName.toLowerCase().includes(guestName.toLowerCase())
      );
    }
    if (checkInMonth !== 'all') {
      filtered = filtered.filter(b => format(parseISO(b.checkIn), 'MMMM') === checkInMonth);
    }
    if (checkoutMonth !== 'all') {
      filtered = filtered.filter(b => format(parseISO(b.checkout), 'MMMM') === checkoutMonth);
    }
    if (owedStatus === 'owed') {
      filtered = filtered.filter(b => getAmountDue(b) > 2);
    } else if (owedStatus === 'paid') {
      filtered = filtered.filter(b => getAmountDue(b) <= 2);
    }

    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let valA, valB;
        switch (sortConfig.key) {
          case 'unit':
            valA = units.find(u => u.id === a.unitId)?.name ?? '';
            valB = units.find(u => u.id === b.unitId)?.name ?? '';
            break;
          case 'lastName':
            valA = a.lastName?.toLowerCase() ?? '';
            valB = b.lastName?.toLowerCase() ?? '';
            break;
          case 'firstName':
            valA = a.firstName?.toLowerCase() ?? '';
            valB = b.firstName?.toLowerCase() ?? '';
            break;
          case 'checkIn':
            valA = parseISO(a.checkIn)?.getTime() ?? 0;
            valB = parseISO(b.checkIn)?.getTime() ?? 0;
            break;
          case 'checkout':
            valA = parseISO(a.checkout)?.getTime() ?? 0;
            valB = parseISO(b.checkout)?.getTime() ?? 0;
            break;
          case 'rateType':
            valA = a.lineItems?.[0]?.type ?? '';
            valB = b.lineItems?.[0]?.type ?? '';
            break;
          case 'rate':
            valA = a.lineItems?.[0]?.rate ?? 0;
            valB = b.lineItems?.[0]?.rate ?? 0;
            break;
          case 'deposit':
            valA = a.deposit ?? 0;
            valB = b.deposit ?? 0;
            break;
          case 'totalCost':
            valA = getTotalCost(a);
            valB = getTotalCost(b);
            break;
          case 'totalPaid':
            valA = getAmountPaid(a.payments);
            valB = getAmountPaid(b.payments);
            break;
          case 'dueNow':
            valA = getDueNow(a);
            valB = getDueNow(b);
            break;
          case 'totalOwed':
            valA = getAmountDue(a);
            valB = getAmountDue(b);
            break;
          default:
            valA = 0;
            valB = 0;
        }

        if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return filtered;
  };

  if (loading) {
    return (
      <div className="bg-gray-100 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-xl text-gray-600">Loading Property Management System...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-100 min-h-screen p-8 pb-20 font-sans ${isFontSizeIncreased ? 'text-lg' : ''}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&display=swap');
        body { font-family: 'Roboto Condensed', sans-serif; }
        .input-field {
          border: 1px solid #d1d5db;
          border-radius: 0.25rem;
          padding: 0.25rem 0.5rem;
          width: 100%;
          transition: all 0.2s ease-in-out;
          outline: none;
          font-size: 0.875rem;
          height: 2rem;
        }
        .input-field:focus {
          border-color: #60a5fa;
          box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.5);
        }
        .contact-input {
          padding: 0.5rem;
          border-radius: 0.375rem;
          border: 1px solid #d1d5db;
          width: 100%;
        }
        .modal-grid-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .w-20ch { width: 20ch; }
        .w-15ch { width: 15ch; }
        .w-10ch { width: 10ch; }
        .text-sm {
          font-size: ${isFontSizeIncreased ? '1.125rem' : '0.875rem'};
        }
        .text-xs {
          font-size: ${isFontSizeIncreased ? '0.875rem' : '0.75rem'};
        }
        .text-sm-base {
          font-size: ${isFontSizeIncreased ? '1.125rem' : '0.875rem'};
          line-height: 1.25rem;
        }
        .text-xs-sm {
          font-size: ${isFontSizeIncreased ? '0.875rem' : '0.75rem'};
          line-height: 1rem;
        }
        .expanded-grid {
          grid-template-columns: 1fr 1fr 1fr 1fr 1fr 0.1fr 1fr 1fr 1fr 1fr 1fr 1fr;
        }
        .expanded-grid > div:nth-child(6) {
          width: 10ch;
        }
        .accounting-expanded-grid {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr 1fr 1fr 0.1fr 1fr 1fr 1fr 1fr 1fr 1fr;
              gap: 0.5rem;
              align-items: center;
        }
        .accounting-expanded-grid > div:nth-child(6) {
              width: 10ch;
        }
        .two-line-cell {
          white-space: nowrap;
        }
      `}</style>
      
      {alertMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white py-2 px-4 rounded-full shadow-lg z-[100]">
          {alertMessage}
        </div>
      )}
      
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-extrabold text-gray-900">Property Manager 🏡</h1>
        <button onClick={toggleFontSize} className="px-4 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors">
          Toggle Font Size
        </button>
      </div>

      <div className="mb-6 w-full">
        {/* Tabs */}
        <div className="flex justify-start space-x-2 mb-8">
          <button
              className="px-6 py-2 text-lg font-medium transition-all duration-300 rounded-full text-white shadow-lg bg-purple-600 hover:bg-purple-700"
              onClick={() => setIsRemindersModalOpen(true)}
              >Reminders</button>
          {['units', 'accounting', 'reports', 'clients'].map(tab => (
            <button
              key={tab}
              className={`px-6 py-2 text-lg font-medium transition-all duration-300 rounded-full ${activeTab === tab ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-600 hover:text-blue-600'}`}
              onClick={() => setActiveTab(tab)}
            >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
          ))}
        </div>
        
        {/* Main Content */}
        <div className="container mx-auto w-full">
          {activeTab === 'units' && (
            <>
              <div className="flex justify-between items-center my-4">
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                   <button onClick={saveData} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 transition-colors text-sm">
                     Export Data
                   </button>
                   <label htmlFor="load-file" className="px-4 py-2 bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 transition-colors text-sm cursor-pointer">
                     Import Data (JSON/CSV)
                   </label>
                   <input id="load-file" type="file" accept=".json,.csv" onChange={loadData} className="hidden"/>
                  </div>
                  {/* Color Legend */}
                  <div className="bg-gray-50 p-3 rounded-lg text-xs">
                    <div className="font-semibold mb-2">🎨 Color & Style Guide:</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                      <div className="flex items-center gap-1">
                        <div className="bg-green-200 border-green-500 border rounded px-2 py-1 text-xs">Current Guest</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="bg-blue-100 border-blue-300 border rounded px-2 py-1 text-xs italic">Checked Out</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="bg-yellow-100 border-yellow-500 border rounded px-2 py-1 text-xs">Vacant Period</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-red-600 font-semibold">RED NAME</span> <span>= Should Check In</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-red-700 font-bold">Red Balance</span> <span>= Owes Money</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-green-700 font-bold">Green Balance</span> <span>= All Paid</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="bg-red-100 border-red-700 border-l-8 px-2 py-1 text-xs">Unit: Owes Money</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="bg-green-100 border-green-700 border-l-8 px-2 py-1 text-xs">Unit: All Paid</div>
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setIsPropertyModalOpen(true)}
                  className="px-4 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors text-sm"
                >
                  New Property
                </button>
              </div>
              
              <div className="space-y-6">
                {properties.map(property => (
                  <div key={property.id} className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex justify-between items-center cursor-pointer" onClick={() => {
                      const newExpanded = new Set(expandedProperties);
                      if (newExpanded.has(property.id)) {
                        newExpanded.delete(property.id);
                      } else {
                        newExpanded.add(property.id);
                      }
                      setExpandedProperties(newExpanded);
                    }}>
                      <div className="flex items-center gap-4">
                        <h2 className="text-2xl font-bold text-gray-800">{property.name}</h2>
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); moveProperty(property.id, 'up'); }} className="text-gray-500 hover:text-gray-700 text-xs" disabled={properties.findIndex(p => p.id === property.id) === 0}>
                            ↑
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); moveProperty(property.id, 'down'); }} className="text-gray-500 hover:text-gray-700 text-xs" disabled={properties.findIndex(p => p.id === property.id) === properties.length - 1}>
                            ↓
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleOpenPropertyEditModal(property); }} className="text-blue-500 hover:text-blue-700 font-bold text-sm ml-2">
                            ✏️
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteProperty(property.id); }} className="text-red-500 hover:text-red-700 font-bold text-sm">
                            ×
                          </button>
                        </div>
                      </div>
                      <span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className={`h-6 w-6 transform transition-transform ${expandedProperties.has(property.id) ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </span>
                    </div>
                    
                    {expandedProperties.has(property.id) && (
                      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                        {units.filter(u => u.propertyId === property.id).map(unit => {
                          // Only show current and future bookings, plus checkouts within 2 days in Units tab
                          // If checkout was Sept 24th, it should show until Sept 26th (2 days after checkout)
                          const twoDaysAfterCheckout = (checkoutDate) => addDays(parseISO(checkoutDate), 2);
                          const currentAndFutureBookings = bookings.filter(b => 
                            b.unitId === unit.id && 
                            (isAfter(parseISO(b.checkout), today) || 
                             (parseISO(b.checkout) <= today && isBefore(today, twoDaysAfterCheckout(b.checkout))))
                          ).sort((a,b) => parseISO(a.checkIn) - parseISO(b.checkIn));
                          const status = getUnitStatus(unit.id);
                          const currentBooking = currentAndFutureBookings.find(b => isBefore(parseISO(b.checkIn), addDays(today, 1)) && isAfter(parseISO(b.checkout), today));
                          let statusColorClass = STATUS_COLORS[status];
                          
                          // Check if there's a booking that should be checked in but isn't
                          const shouldBeCheckedIn = currentAndFutureBookings.find(b => 
                            isBefore(parseISO(b.checkIn), addDays(today, 1)) && 
                            isAfter(parseISO(b.checkout), today) && 
                            b.status !== 'checkedIn'
                          );
                          
                          if (shouldBeCheckedIn) {
                            statusColorClass = 'bg-red-200 border-red-700'; // RED for should be checked in but isn't
                          } else if(currentBooking && (getDueNow(currentBooking) - getRentPaid(currentBooking.payments)) > 2) {
                              statusColorClass = STATUS_COLORS['occupiedOwes']
                          } else if (currentBooking) {
                              statusColorClass = STATUS_COLORS['occupiedPaid']
                          }
                          const bookingElements = [];
                          const sortedBookings = currentAndFutureBookings.sort((a, b) => parseISO(a.checkIn) - parseISO(b.checkIn));
                          
                          if (sortedBookings.length > 0) {
                            const firstCheckIn = parseISO(sortedBookings[0].checkIn);
                            const vacantDaysStart = differenceInDays(firstCheckIn, today);
                            if (isAfter(firstCheckIn, today) && vacantDaysStart > 0) {
                              bookingElements.push(
                                <div key={`vacant-start`} className="bg-yellow-100 border-yellow-500 border rounded-full my-2 text-center text-xs py-1">
                                  VACANT {format(today, 'dMMM').toUpperCase()} - {format(subDays(firstCheckIn, 1), 'dMMM').toUpperCase()} ({vacantDaysStart} days)
                                </div>
                              );
                            }
                            sortedBookings.forEach((b, index) => {
                                const checkInDate = parseISO(b.checkIn);
                                const isCurrent = isAfter(today, subDays(checkInDate, 1)) && isBefore(today, addDays(parseISO(b.checkout), 1));
                                const balance = getDueNow(b) - getRentPaid(b.payments);
                                if (index > 0) {
                                  const prevBooking = sortedBookings[index - 1];
                                  const vacantDaysBetween = differenceInDays(checkInDate, parseISO(prevBooking.checkout));
                                  if (vacantDaysBetween > 0) {
                                    bookingElements.push(
                                      <div key={`vacant-${prevBooking.id}`} className="bg-yellow-100 border-yellow-500 border rounded-full my-2 text-center text-xs py-1">
                                        VACANT {format(parseISO(prevBooking.checkout), 'dMMM').toUpperCase()} - {format(subDays(checkInDate, 1), 'dMMM').toUpperCase()} ({vacantDaysBetween} days)
                                      </div>
                                    );
                                  }
                                }
                                bookingElements.push(
                                    <p key={b.id} className={`my-1.5 flex justify-between items-center ${b.status === 'checkedOut' && (getAmountDue(b) > 2) ? 'font-bold italic text-red-500' : ''} ${isCurrent ? 'bg-green-200 border-green-500 border rounded-full my-2 px-2 py-1' : b.status === 'checkedOut' ? 'bg-blue-100 border-blue-300 border rounded-full my-2 px-2 py-1 italic' : ''}`} style={{ fontSize: 'inherit' }}>
                                        <span className={`font-semibold uppercase cursor-pointer ${
                                          !isCurrent && parseISO(b.checkIn) <= today && (b.status === 'none' || !b.status) ? 'text-red-600' : ''
                                        }`} onClick={() => handleOpenBookingModal(b)}>{b.name}</span>
                                        <span className="text-gray-500 text-sm">
                                            ({format(parseISO(b.checkIn), 'dMMM').toUpperCase()}-{format(parseISO(b.checkout), 'dMMMyy').toUpperCase()}) {getDisplayRate(b)} | Balance:
                                            <span className={`font-bold ${balance > 2 ? 'text-red-700' : 'text-green-700'}`}>{balance.toFixed(0)}฿</span>
                                        </span>
                                    </p>
                                );
                            });
                          } else {
                              bookingElements.push(<p key="vacant" className="text-gray-500 italic text-xl mt-2">VACANT</p>);
                          }
                          
                          return (
                            <div key={unit.id} className={`relative p-6 rounded-xl shadow-md border-l-8 ${statusColorClass}`}>
                              <h3 onClick={() => handleOpenUnitModal(unit)} className="text-2xl font-bold mb-2 text-gray-800 cursor-pointer hover:underline">{unit.name}</h3>
                              <div className="mt-2" style={{ fontSize: isFontSizeIncreased ? '1em' : '0.875em' }}>
                                {bookingElements}
                              </div>
                              <div className="absolute top-4 right-4 flex items-center space-x-1">
                                  <div className="flex flex-col">
                                    <button onClick={(e) => { e.stopPropagation(); const unitsInProperty = units.filter(u => u.propertyId === unit.propertyId); moveUnit(unit.id, 'up'); }} className="text-gray-400 hover:text-gray-600 text-xs" disabled={units.filter(u => u.propertyId === unit.propertyId).findIndex(u => u.id === unit.id) === 0}>
                                      ↑
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); const unitsInProperty = units.filter(u => u.propertyId === unit.propertyId); moveUnit(unit.id, 'down'); }} className="text-gray-400 hover:text-gray-600 text-xs" disabled={units.filter(u => u.propertyId === unit.propertyId).findIndex(u => u.id === unit.id) === units.filter(u => u.propertyId === unit.propertyId).length - 1}>
                                      ↓
                                    </button>
                                  </div>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteUnit(unit.id); }} className="text-red-500 hover:text-red-700 font-bold text-sm">
                                    ×
                                  </button>
                                <button
                                  onClick={() => handleOpenBookingModal(null, unit.id)}
                                  className="px-2 py-1 bg-white text-blue-500 rounded-full shadow-sm hover:bg-gray-100 transition-colors text-xs"
                                >
                                  New Booking
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        
                        <div className="p-6 rounded-xl border-2 border-dashed border-gray-300 text-center flex flex-col justify-center items-center hover:bg-gray-50 transition-colors cursor-pointer"
                            onClick={async () => {
                              const newId = `unit-${Date.now()}`;
                              const newUnit = {
                                id: newId,
                                propertyId: property.id,
                                name: `Unit ${newId}`,
                                description: '',
                                internalNotes: '',
                                dailyRate: 0,
                                weeklyRate: 0,
                                monthlyRate: 0,
                                monthlyWaterCharge: 0,
                              };
                              try {
                                await axios.post(`${API}/units`, newUnit);
                                await fetchData();
                                handleShowAlert('Unit added successfully!');
                              } catch (e) {
                                console.error("Error adding unit:", e);
                                handleShowAlert("Failed to add unit. Please try again.");
                              }
                            }}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <span className="mt-2 text-gray-600 font-medium">Add New Unit</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          
          {activeTab === 'accounting' && (
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">Accounting Overview</h2>
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-4 text-sm">
                   <h3 className="font-bold">Filters:</h3>
                   <label className="flex items-center gap-2">
                     <span>Unit:</span>
                     <select
                       className="input-field w-24"
                       value={accountingFilters.unitId}
                       onChange={(e) => setAccountingFilters({ ...accountingFilters, unitId: e.target.value })}
                     >
                       <option value="all">All</option>
                       {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                     </select>
                   </label>
                   <label className="flex items-center gap-2">
                     <span>Guest:</span>
                     <input
                       type="text"
                       className="input-field w-32"
                       placeholder="Search name..."
                       value={accountingFilters.guestName}
                       onChange={(e) => setAccountingFilters({ ...accountingFilters, guestName: e.target.value })}
                     />
                   </label>
                   <label className="flex items-center gap-2">
                     <span>Check-In Month:</span>
                     <select
                       className="input-field w-28"
                       value={accountingFilters.checkInMonth}
                       onChange={(e) => setAccountingFilters({ ...accountingFilters, checkInMonth: e.target.value })}
                     >
                       <option value="all">All</option>
                       {chronologicalMonths.slice(1).map(month => <option key={month} value={month}>{month}</option>)}
                     </select>
                   </label>
                   <label className="flex items-center gap-2">
                     <span>Checkout Month:</span>
                     <select
                       className="input-field w-28"
                       value={accountingFilters.checkoutMonth}
                       onChange={(e) => setAccountingFilters({ ...accountingFilters, checkoutMonth: e.target.value })}
                     >
                       <option value="all">All</option>
                       {chronologicalMonths.slice(1).map(month => <option key={month} value={month}>{month}</option>)}
                     </select>
                   </label>
                   <label className="flex items-center gap-2">
                     <span>Owed Status:</span>
                     <select
                       className="input-field w-28"
                       value={accountingFilters.owedStatus}
                       onChange={(e) => setAccountingFilters({ ...accountingFilters, owedStatus: e.target.value })}
                     >
                       <option value="all">All</option>
                       <option value="owed">Owed</option>
                       <option value="paid">Paid</option>
                     </select>
                   </label>
                 </div>
               </div>
               
               <div className="flex flex-col">
                 <div className="bg-gray-200 rounded-t-lg font-bold p-2 grid grid-cols-12 gap-2 text-xs border-b border-gray-300">
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('unit')}>Unit</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('lastName')}>Last Name</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('firstName')}>First Name</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('checkIn')}>Check-In</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('checkout')}>Checkout</div>
                   <div className="w-10ch border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('rateType')}>Type</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('rate')}>Rate</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('deposit')}>Deposit</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('totalCost')}>Total Cost</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('totalPaid')}>Total Paid</div>
                   <div className="col-span-1 border-r border-gray-300 pr-2 cursor-pointer" onClick={() => requestSort('dueNow')}>Due Now</div>
                   <div className="col-span-1 cursor-pointer" onClick={() => requestSort('totalOwed')}>Total Owed</div>
                 </div>
                 
                 <div className="divide-y divide-gray-200">
                   {filteredAndSortedBookings().map(booking => (
                     <div key={booking.id}>
                       <div className="grid grid-cols-12 gap-2 items-center text-sm py-2 hover:bg-gray-50">
                         <div className="col-span-1 cursor-pointer" onClick={() => handleOpenUnitModal(units.find(u => u.id === booking.unitId))}>{units.find(u => u.id === booking.unitId)?.name}</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => handleOpenBookingModal(booking)}>{booking.lastName}</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => handleOpenBookingModal(booking)}>{booking.firstName}</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{format(parseISO(booking.checkIn), 'dLLLyy')}</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{format(parseISO(booking.checkout), 'dLLLyy')}</div>
                         <div className="w-10ch capitalize cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{booking.lineItems.length > 0 ? booking.lineItems[0].type.charAt(0).toUpperCase() : ''}</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{booking.totalPrice > 0 ? (booking.totalPrice - booking.commission).toFixed(0) : (booking.lineItems.length > 0 ? booking.lineItems[0].rate : '')}฿</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{getAmountPaid(booking.payments) >= booking.deposit ? booking.deposit : 0}฿</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{getTotalCost(booking).toFixed(0)}฿</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{getAmountPaid(booking.payments).toFixed(0)}฿</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>{getDueNow(booking).toFixed(0)}฿</div>
                         <div className="col-span-1 cursor-pointer" onClick={() => setExpandedRow(expandedRow === booking.id ? null : booking.id)}>
                           <span className={`font-bold ${getAmountDue(booking) > 2 ? 'text-red-700' : 'text-green-700'}`}>
                             {getAmountDue(booking).toFixed(0)}฿
                           </span>
                         </div>
                       </div>
                       
                       {expandedRow === booking.id && (
                         <div className="bg-gray-100 p-4 border-t border-gray-200">
                             <div className="grid grid-cols-12 gap-2 text-sm text-blue-900">
                             <div className="col-start-4 col-span-2 text-left">
                                 <h4 className="font-bold">Rental Periods:</h4>
                                 {booking.lineItems.map((item, index) => (
                                    <div key={index} className="flex justify-start space-x-2">
                                        <div>{format(typeof item.startDate === 'string' ? parseISO(item.startDate) : new Date(item.startDate), 'dLLLyy').toUpperCase()} -</div>
                                        <div>{format(typeof item.endDate === 'string' ? parseISO(item.endDate) : new Date(item.endDate), 'dLLLyy').toUpperCase()}</div>
                                    </div>
                                   ))}
                             </div>
                             <div className="col-start-6 w-10ch text-left">
                                 <h4 className="font-bold">Type:</h4>
                                 {booking.lineItems.map((item, index) => (
                                    <div key={index} className="capitalize">{item.type.charAt(0).toUpperCase()}</div>
                                   ))}
                             </div>
                             <div className="col-start-7 col-span-1 text-left">
                                 <h4 className="font-bold">Rate:</h4>
                                 {booking.lineItems.map((item, index) => (
                                    <div key={index}>{item.cost.toFixed(0)}฿</div>
                                   ))}
                             </div>
                             <div className="col-start-9 col-span-2 text-left">
                                 <h4 className="font-bold">Payments:</h4>
                                 {booking.payments.map((payment, index) => (
                                    <div key={index} className="flex justify-between">
                                       <span className="text-left">{format(parseISO(payment.date), 'dLLLyy').toUpperCase()} ({payment.category})</span>
                                       <span className="text-right">{payment.amount.toFixed(0)}฿</span>
                                    </div>
                                   ))}
                             </div>
                           </div>
                         </div>
                       )}
                     </div>
                   ))}
                 </div>
               </div>
               
               <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                 {/* Expense Section - Simplified for now */}
                 <div className="bg-white p-6 rounded-lg shadow-md">
                   <h3 className="text-xl font-bold mb-4 text-gray-800">Add New Expense</h3>
                   <div className="space-y-4">
                     <div className="flex gap-4">
                       <div className="flex-1">
                         <label className="text-xs font-medium">Date:</label>
                         <input
                           type="date"
                           className="input-field"
                           value={newExpense.date}
                           onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                         />
                       </div>
                       <div className="flex-1">
                         <label className="text-xs font-medium">Amount (฿):</label>
                         <input
                           type="number"
                           className="input-field"
                           value={newExpense.amount}
                           onChange={e => setNewExpense({ ...newExpense, amount: Number(e.target.value) })}
                         />
                       </div>
                     </div>
                     <div>
                       <label className="text-xs font-medium">Description:</label>
                       <input
                         type="text"
                         className="input-field"
                         value={newExpense.description}
                         onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                       />
                     </div>
                     <div>
                       <label className="text-xs font-medium">Category:</label>
                       <select
                         className="input-field"
                         value={newExpense.category}
                         onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                       >
                         <option value="Rent">Rent</option>
                         <option value="Salary">Salary</option>
                         <option value="WiFi">WiFi</option>
                         <option value="Electric">Electric</option>
                         <option value="Water">Water</option>
                         <option value="Upgrades">Upgrades</option>
                         <option value="Repairs">Repairs</option>
                         <option value="Other">Other</option>
                       </select>
                     </div>
                     <div>
                       <label className="text-xs font-medium">Property:</label>
                       <select
                         className="input-field"
                         value={newExpense.propertyId}
                         onChange={e => {
                           setNewExpense({ ...newExpense, propertyId: e.target.value, unitId: '' });
                         }}
                       >
                         <option value="">General</option>
                         {properties.map(property => (
                           <option key={property.id} value={property.id}>{property.name}</option>
                         ))}
                       </select>
                     </div>
                     {newExpense.propertyId && (
                       <div>
                         <label className="text-xs font-medium">Unit (Optional):</label>
                         <select
                           className="input-field"
                           value={newExpense.unitId}
                           onChange={e => setNewExpense({ ...newExpense, unitId: e.target.value })}
                         >
                           <option value="">Property-wide</option>
                           {units.filter(u => u.propertyId === newExpense.propertyId).map(unit => (
                             <option key={unit.id} value={unit.id}>{unit.name}</option>
                           ))}
                         </select>
                       </div>
                     )}
                     <button onClick={async () => {
                       if (!newExpense.amount || !newExpense.description || (!newExpense.propertyId && !newExpense.unitId)) {
                         handleShowAlert("Please fill in all expense fields, and assign to a property or unit.");
                         return;
                       }
                       try {
                         await axios.post(`${API}/expenses`, newExpense);
                         await fetchData();
                         setNewExpense({ date: format(today, 'yyyy-MM-dd'), amount: 0, description: '', category: 'Repairs', propertyId: '', unitId: '' });
                         handleShowAlert('Expense added successfully!');
                       } catch (e) {
                         console.error("Error adding expense:", e);
                         handleShowAlert("Failed to add expense. Please try again.");
                       }
                     }} className="w-full bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600">Add Expense</button>
                   </div>
                 </div>
                 
                 {/* Report Section - Enhanced */}
                 <div className="bg-white p-6 rounded-lg shadow-md">
                   <h3 className="text-xl font-bold mb-4 text-gray-800">Financial Reports</h3>
                   <div className="space-y-4">
                     <div className="p-4 rounded-lg bg-green-50 border-l-4 border-green-700">
                       <h4 className="font-bold">Summary</h4>
                       <p>Total Income: <span className="font-semibold">{bookings.reduce((sum, b) => {
                         // Only count non-deposit payments as income
                         const incomePayments = b.payments.filter(p => p.category !== 'Deposit');
                         return sum + incomePayments.reduce((pSum, p) => pSum + p.amount, 0);
                       }, 0).toFixed(0)}฿</span></p>
                       <p>Total Deposits Collected: <span className="font-semibold">{bookings.reduce((sum, b) => {
                         // Count only deposit payments
                         const depositPayments = b.payments.filter(p => p.category === 'Deposit');
                         return sum + depositPayments.reduce((pSum, p) => pSum + p.amount, 0);
                       }, 0).toFixed(0)}฿</span></p>
                       <p>Total Expenses: <span className="font-semibold">{expenses.reduce((sum, e) => sum + e.amount, 0).toFixed(0)}฿</span></p>
                       <p className="mt-2 font-bold text-lg">Net Income: <span className="text-green-700">{(bookings.reduce((sum, b) => {
                         const incomePayments = b.payments.filter(p => p.category !== 'Deposit');
                         return sum + incomePayments.reduce((pSum, p) => pSum + p.amount, 0);
                       }, 0) - expenses.reduce((sum, e) => sum + e.amount, 0)).toFixed(0)}฿</span></p>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
           )}
           
           {activeTab === 'reports' && (
             <div className="bg-white p-6 rounded-lg shadow-md">
               <h2 className="text-2xl font-bold mb-4 text-gray-800">Financial Reports & Analysis</h2>
               
               {/* Report Generation */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                 <div className="bg-gray-50 p-6 rounded-lg">
                   <h3 className="text-xl font-bold mb-4">Generate Excel Reports</h3>
                   <div className="space-y-4">
                     <button 
                       onClick={() => {
                         const reportData = [];
                         bookings.forEach(booking => {
                           const unit = units.find(u => u.id === booking.unitId);
                           const property = properties.find(p => p.id === unit?.propertyId);
                           reportData.push({
                             'Property': property?.name || 'Unknown',
                             'Unit': unit?.name || 'Unknown',
                             'Name': `${booking.firstName} ${booking.lastName}`.trim(),
                             'First Name': booking.firstName,
                             'Last Name': booking.lastName,
                             'Check-in': booking.checkIn,
                             'Checkout': booking.checkout,
                             'Source': booking.source,
                             'Total Cost': getTotalCost(booking),
                             'Total Price': booking.totalPrice || 0,
                             'Commission': booking.commission || 0,
                             'Amount Paid': getAmountPaid(booking.payments),
                             'Amount Due': getAmountDue(booking),
                             'Deposit': booking.deposit,
                             'Monthly Rate': booking.monthlyRate,
                             'Weekly Rate': booking.weeklyRate,
                             'Daily Rate': booking.dailyRate,
                             'Status': booking.status,
                             'Phone': booking.phone,
                             'Email': booking.email,
                             'WhatsApp': booking.whatsapp,
                             'LINE': booking.line,
                             'Instagram': booking.instagram,
                             'Facebook': booking.facebook,
                             'Preferred Contact': booking.preferredContact,
                             'Notes': booking.notes
                           });
                         });
                         
                         const ws = XLSX.utils.json_to_sheet(reportData);
                         const wb = XLSX.utils.book_new();
                         XLSX.utils.book_append_sheet(wb, ws, "Bookings Report");
                         XLSX.writeFile(wb, `bookings_report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
                         handleShowAlert('Bookings report exported to Excel!');
                       }}
                       className="w-full bg-green-500 text-white px-4 py-2 rounded-full hover:bg-green-600 mb-2"
                     >
                       📊 Export Bookings Excel
                     </button>
                     
                     <button 
                       onClick={() => {
                         const reportData = [];
                         bookings.forEach(booking => {
                           const unit = units.find(u => u.id === booking.unitId);
                           const property = properties.find(p => p.id === unit?.propertyId);
                           reportData.push({
                             'Property': property?.name || 'Unknown',
                             'Unit': unit?.name || 'Unknown',
                             'Name': `${booking.firstName} ${booking.lastName}`.trim(),
                             'First Name': booking.firstName,
                             'Last Name': booking.lastName,
                             'Check-in': booking.checkIn,
                             'Checkout': booking.checkout,
                             'Source': booking.source,
                             'Total Cost': getTotalCost(booking),
                             'Total Price': booking.totalPrice || 0,
                             'Commission': booking.commission || 0,
                             'Amount Paid': getAmountPaid(booking.payments),
                             'Amount Due': getAmountDue(booking),
                             'Deposit': booking.deposit,
                             'Monthly Rate': booking.monthlyRate,
                             'Weekly Rate': booking.weeklyRate,
                             'Daily Rate': booking.dailyRate,
                             'Status': booking.status,
                             'Phone': booking.phone,
                             'Email': booking.email,
                             'WhatsApp': booking.whatsapp,
                             'LINE': booking.line,
                             'Instagram': booking.instagram,
                             'Facebook': booking.facebook,
                             'Preferred Contact': booking.preferredContact,
                             'Notes': booking.notes
                           });
                         });
                         
                         const csv = Papa.unparse(reportData);
                         const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                         const link = document.createElement('a');
                         const url = URL.createObjectURL(blob);
                         link.setAttribute('href', url);
                         link.setAttribute('download', `bookings_backup_${format(new Date(), 'yyyy-MM-dd')}.csv`);
                         link.style.visibility = 'hidden';
                         document.body.appendChild(link);
                         link.click();
                         document.body.removeChild(link);
                         handleShowAlert('Bookings backup exported to CSV!');
                       }}
                       className="w-full bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600"
                     >
                       💾 Export Bookings CSV (Backup)
                     </button>
                     
                     <button 
                       onClick={() => {
                         const reportData = [];
                         properties.forEach(property => {
                           const propertyUnits = units.filter(u => u.propertyId === property.id);
                           const propertyBookings = bookings.filter(b => propertyUnits.some(u => u.id === b.unitId));
                           const totalIncome = propertyBookings.reduce((sum, b) => {
                             const incomePayments = b.payments.filter(p => p.category !== 'Deposit');
                             return sum + incomePayments.reduce((pSum, p) => pSum + p.amount, 0);
                           }, 0);
                           const totalDeposits = propertyBookings.reduce((sum, b) => {
                             const depositPayments = b.payments.filter(p => p.category === 'Deposit');
                             return sum + depositPayments.reduce((pSum, p) => pSum + p.amount, 0);
                           }, 0);
                           const propertyExpenses = expenses.filter(e => e.propertyId === property.id);
                           const totalExpenses = propertyExpenses.reduce((sum, e) => sum + e.amount, 0);
                           
                           reportData.push({
                             'Property': property.name,
                             'Units': propertyUnits.length,
                             'Total Bookings': propertyBookings.length,
                             'Total Income': totalIncome,
                             'Total Deposits': totalDeposits,
                             'Total Expenses': totalExpenses,
                             'Net Profit': totalIncome - totalExpenses,
                             'Occupancy Rate': `${propertyBookings.length > 0 ? ((propertyBookings.length / propertyUnits.length) * 100).toFixed(1) : 0}%`
                           });
                         });
                         
                         const ws = XLSX.utils.json_to_sheet(reportData);
                         const wb = XLSX.utils.book_new();
                         XLSX.utils.book_append_sheet(wb, ws, "Property Performance");
                         XLSX.writeFile(wb, `property_performance_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
                         handleShowAlert('Property performance report exported!');
                       }}
                       className="w-full bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600"
                     >
                       🏢 Export Property Performance
                     </button>
                     
                     <button 
                       onClick={() => {
                         const reportData = expenses.map(expense => {
                           const property = properties.find(p => p.id === expense.propertyId);
                           const unit = units.find(u => u.id === expense.unitId);
                           return {
                             'Date': expense.date,
                             'Property': property?.name || 'General',
                             'Unit': unit?.name || 'Property-wide',
                             'Category': expense.category,
                             'Description': expense.description,
                             'Amount': expense.amount
                           };
                         });
                         
                         const ws = XLSX.utils.json_to_sheet(reportData);
                         const wb = XLSX.utils.book_new();
                         XLSX.utils.book_append_sheet(wb, ws, "Expenses Report");
                         XLSX.writeFile(wb, `expenses_report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
                         handleShowAlert('Expenses report exported!');
                       }}
                       className="w-full bg-red-500 text-white px-4 py-2 rounded-full hover:bg-red-600"
                     >
                       💰 Export Expenses Report
                     </button>
                   </div>
                 </div>
                 
                 {/* In-App Analysis */}
                 <div className="bg-gray-50 p-6 rounded-lg">
                   <h3 className="text-xl font-bold mb-4">Financial Analysis</h3>
                   <div className="space-y-4">
                     <div className="bg-white p-4 rounded border">
                       <h4 className="font-bold text-lg">Monthly Performance</h4>
                       <div className="grid grid-cols-2 gap-4 mt-2">
                         {chronologicalMonths.slice(1).map(month => {
                           // Calculate income based on rental periods, not payment dates
                           let monthIncome = 0;
                           bookings.forEach(booking => {
                             const checkInDate = parseISO(booking.checkIn);
                             const checkoutDate = parseISO(booking.checkout);
                             
                             // Check if this month overlaps with the booking period
                             const monthStart = new Date(2025, chronologicalMonths.indexOf(month) - 1, 1);
                             const monthEnd = new Date(2025, chronologicalMonths.indexOf(month), 0);
                             
                             if (checkInDate <= monthEnd && checkoutDate >= monthStart) {
                               // Calculate what portion of the rental applies to this month
                               const overlapStart = checkInDate > monthStart ? checkInDate : monthStart;
                               const overlapEnd = checkoutDate < monthEnd ? checkoutDate : monthEnd;
                               const overlapDays = differenceInDays(addDays(overlapEnd, 1), overlapStart);
                               const totalBookingDays = differenceInDays(checkoutDate, checkInDate);
                               
                               if (totalBookingDays > 0) {
                                 const totalRent = getRentCost(booking);
                                 const monthlyPortion = (overlapDays / totalBookingDays) * totalRent;
                                 monthIncome += monthlyPortion;
                               }
                             }
                           });
                           
                           const monthExpenses = expenses.filter(e => format(parseISO(e.date), 'MMMM') === month).reduce((sum, e) => sum + e.amount, 0);
                           const profit = monthIncome - monthExpenses;
                           
                           if (monthIncome > 0 || monthExpenses > 0) {
                             return (
                               <div key={month} className="text-sm">
                                 <strong>{month}:</strong><br/>
                                 Income: {monthIncome.toFixed(0)}฿<br/>
                                 Expenses: {monthExpenses.toFixed(0)}฿<br/>
                                 <span className={profit >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                                   Profit: {profit.toFixed(0)}฿
                                 </span>
                               </div>
                             );
                           }
                           return null;
                         })}
                       </div>
                     </div>
                     
                     <div className="bg-white p-4 rounded border">
                       <h4 className="font-bold text-lg">Unit Performance</h4>
                       <div className="max-h-48 overflow-y-auto">
                         {units.map(unit => {
                           const unitBookings = bookings.filter(b => b.unitId === unit.id);
                           const unitIncome = unitBookings.reduce((sum, b) => {
                             const incomePayments = b.payments.filter(p => p.category !== 'Deposit');
                             return sum + incomePayments.reduce((pSum, p) => pSum + p.amount, 0);
                           }, 0);
                           const unitExpenses = expenses.filter(e => e.unitId === unit.id).reduce((sum, e) => sum + e.amount, 0);
                           
                           if (unitIncome > 0 || unitExpenses > 0) {
                             return (
                               <div key={unit.id} className="flex justify-between text-sm py-1 border-b">
                                 <span className="font-medium">{unit.name}:</span>
                                 <span>Income: {unitIncome.toFixed(0)}฿ | Expenses: {unitExpenses.toFixed(0)}฿ | 
                                   <span className={unitIncome - unitExpenses >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                                     Net: {(unitIncome - unitExpenses).toFixed(0)}฿
                                   </span>
                                 </span>
                               </div>
                             );
                           }
                           return null;
                         })}
                       </div>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
           )}
           
           {activeTab === 'clients' && (
             <div className="bg-white p-6 rounded-lg shadow-md">
               <h2 className="text-2xl font-bold mb-4 text-gray-800">Client Database</h2>
               
               {/* Client List */}
               <div className="mb-6">
                 <div className="flex justify-between items-center mb-4">
                   <h3 className="text-xl font-bold">All Clients</h3>
                   <button 
                     onClick={() => {
                       const clientData = [];
                       // Get unique clients from bookings
                       const uniqueClients = bookings.reduce((acc, booking) => {
                         const clientKey = `${booking.firstName}_${booking.lastName}_${booking.email || booking.phone}`;
                         if (!acc[clientKey]) {
                           const clientBookings = bookings.filter(b => 
                             b.firstName === booking.firstName && 
                             b.lastName === booking.lastName &&
                             (b.email === booking.email || b.phone === booking.phone)
                           );
                           const totalSpent = clientBookings.reduce((sum, b) => sum + getAmountPaid(b.payments), 0);
                           const totalOwed = clientBookings.reduce((sum, b) => sum + getAmountDue(b), 0);
                           
                           acc[clientKey] = {
                             'First Name': booking.firstName,
                             'Last Name': booking.lastName,
                             'Email': booking.email,
                             'Phone': booking.phone,
                             'WhatsApp': booking.whatsapp,
                             'Instagram': booking.instagram,
                             'Line': booking.line,
                             'Facebook': booking.facebook,
                             'Preferred Contact': booking.preferredContact,
                             'Total Bookings': clientBookings.length,
                             'Total Spent': totalSpent,
                             'Amount Owed': totalOwed,
                             'Last Stay': clientBookings.sort((a, b) => parseISO(b.checkIn) - parseISO(a.checkIn))[0].checkIn,
                             'Source': booking.source
                           };
                         }
                         return acc;
                       }, {});
                       
                       const ws = XLSX.utils.json_to_sheet(Object.values(uniqueClients));
                       const wb = XLSX.utils.book_new();
                       XLSX.utils.book_append_sheet(wb, ws, "Client Database");
                       XLSX.writeFile(wb, `client_database_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
                       handleShowAlert('Client database exported!');
                     }}
                     className="bg-green-500 text-white px-4 py-2 rounded-full hover:bg-green-600"
                   >
                     📥 Export Client Database
                   </button>
                 </div>
                 
                 <div className="overflow-x-auto">
                   <table className="w-full border-collapse border border-gray-300">
                     <thead>
                       <tr className="bg-gray-100">
                         <th className="border border-gray-300 px-4 py-2 text-left">Name</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Phone</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Email</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">WhatsApp</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">LINE</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Instagram</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Facebook</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Preferred</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Bookings</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Total Spent</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Amount Owed</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Last Stay</th>
                         <th className="border border-gray-300 px-4 py-2 text-left">Source</th>
                       </tr>
                     </thead>
                     <tbody>
                       {(() => {
                         // Get unique clients
                         const uniqueClients = bookings.reduce((acc, booking) => {
                           const clientKey = `${booking.firstName}_${booking.lastName}_${booking.email || booking.phone}`;
                           if (!acc[clientKey]) {
                             const clientBookings = bookings.filter(b => 
                               b.firstName === booking.firstName && 
                               b.lastName === booking.lastName &&
                               (b.email === booking.email || b.phone === booking.phone)
                             );
                             const totalSpent = clientBookings.reduce((sum, b) => sum + getAmountPaid(b.payments), 0);
                             const totalOwed = clientBookings.reduce((sum, b) => sum + getAmountDue(b), 0);
                             
                             acc[clientKey] = {
                               firstName: booking.firstName,
                               lastName: booking.lastName,
                               phone: booking.phone,
                               email: booking.email,
                               whatsapp: booking.whatsapp,
                               line: booking.line,
                               instagram: booking.instagram,
                               facebook: booking.facebook,
                               preferredContact: booking.preferredContact,
                               bookings: clientBookings.length,
                               totalSpent: totalSpent,
                               amountOwed: totalOwed,
                               lastStay: clientBookings.sort((a, b) => parseISO(b.checkIn) - parseISO(a.checkIn))[0].checkIn,
                               source: booking.source
                             };
                           }
                           return acc;
                         }, {});
                         
                         return Object.values(uniqueClients).map((client, index) => (
                           <tr key={index} className="hover:bg-gray-50">
                             <td className="border border-gray-300 px-4 py-2">{client.firstName} {client.lastName}</td>
                             <td className="border border-gray-300 px-4 py-2">{client.phone || '-'}</td>
                             <td className="border border-gray-300 px-4 py-2">{client.email || '-'}</td>
                             <td className="border border-gray-300 px-4 py-2">{client.whatsapp || '-'}</td>
                             <td className="border border-gray-300 px-4 py-2">{client.line || '-'}</td>
                             <td className="border border-gray-300 px-4 py-2">{client.instagram || '-'}</td>
                             <td className="border border-gray-300 px-4 py-2">{client.facebook || '-'}</td>
                             <td className="border border-gray-300 px-4 py-2">
                               <strong>{client.preferredContact}</strong>
                             </td>
                             <td className="border border-gray-300 px-4 py-2 text-center">{client.bookings}</td>
                             <td className="border border-gray-300 px-4 py-2 text-right">{client.totalSpent.toFixed(0)}฿</td>
                             <td className="border border-gray-300 px-4 py-2 text-right">
                               <span className={client.amountOwed > 2 ? 'text-red-600 font-bold' : 'text-green-600'}>
                                 {client.amountOwed.toFixed(0)}฿
                               </span>
                             </td>
                             <td className="border border-gray-300 px-4 py-2">{format(parseISO(client.lastStay), 'MMM d, yyyy')}</td>
                             <td className="border border-gray-300 px-4 py-2 capitalize">{client.source}</td>
                           </tr>
                         ));
                       })()}
                     </tbody>
                   </table>
                 </div>
               </div>
             </div>
           )}
        </div>
      </div>
      
      {/* Continue with all your modals... I'll add a few key ones first */}
      
      {/* New Property Modal */}
      {isPropertyModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-8 rounded-xl shadow-2xl max-w-lg w-full relative">
            <button
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => setIsPropertyModalOpen(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Create New Property</h2>
            <div className="flex flex-col space-y-4">
              <label className="text-xs font-medium">Property Name:</label>
              <input
                type="text"
                className="input-field"
                value={newProperty.name}
                onChange={e => setNewProperty({ name: e.target.value })}
                placeholder="e.g., 123 Main Street"
              />
              <button
                onClick={async () => {
                  if (!newProperty.name) {
                    handleShowAlert("Property name cannot be empty.");
                    return;
                  }
                  try {
                    await axios.post(`${API}/properties`, { name: newProperty.name });
                    await fetchData();
                    setNewProperty({ name: '' });
                    setIsPropertyModalOpen(false);
                    handleShowAlert('Property created successfully!');
                  } catch (e) {
                    console.error("Error creating property:", e);
                    handleShowAlert("Failed to create property. Please try again.");
                  }
                }}
                className="w-full bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600"
              >
                Create Property
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Reminders Modal */}
      {isRemindersModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-8 rounded-xl shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto relative">
            <button
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => setIsRemindersModalOpen(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Upcoming Reminders</h2>
            <div className="mb-4">
              <h3 className="font-bold text-gray-700 mb-2">Add New Reminder</h3>
              <div className="flex flex-col gap-2">
                <input
                  type="date"
                  className="input-field"
                  value={newReminderData.date ?? ''}
                  onChange={(e) => setNewReminderData(prev => ({ ...prev, date: e.target.value }))}
                />
                <select
                  className="input-field"
                  value={newReminderData.unitId ?? ''}
                  onChange={(e) => setNewReminderData(prev => ({ ...prev, unitId: e.target.value }))}
                >
                  <option value="">N/A</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select
                  className="input-field"
                  value={newReminderData.type}
                  onChange={(e) => setNewReminderData(prev => ({ ...prev, type: e.target.value }))}
                >
                  <option value="checkin">Check-in</option>
                  <option value="checkout">Checkout</option>
                  <option value="rent">Rent Due</option>
                  <option value="vacant">Vacant</option>
                  <option value="other">Other</option>
                </select>
                <textarea
                   placeholder="Notes (e.g., Arthur, 10000฿)"
                   className="input-field h-16"
                   value={newReminderData.note ?? ''}
                   onChange={(e) => setNewReminderData(prev => ({ ...prev, note: e.target.value }))}
                 />
              </div>
              <button onClick={() => {
                if (!newReminderData.date) {
                  handleShowAlert("Date is required for a reminder.");
                  return;
                }
                const unitName = newReminderData.unitId ? units.find(u => u.id === newReminderData.unitId)?.name : 'N/A';
                let reminderText;
                if (newReminderData.type === 'checkin') {
                  reminderText = `${unitName}: Check-in ${newReminderData.note || ''}`;
                } else if (newReminderData.type === 'checkout') {
                  reminderText = `${unitName}: Checkout ${newReminderData.note || ''}`;
                } else if (newReminderData.type === 'rent') {
                  reminderText = `${unitName}: Rent due ${newReminderData.note || ''}`;
                } else if (newReminderData.type === 'vacant') {
                  reminderText = `${unitName}: Vacant ${newReminderData.note || ''}`;
                } else { // other
                  reminderText = `${unitName}: ${newReminderData.note || 'Custom reminder'}`;
                }
                setReminders(prev => [...prev, { 
                  date: parseISO(newReminderData.date), 
                  text: reminderText, 
                  type: newReminderData.type, 
                  unitId: newReminderData.unitId || '', 
                  note: newReminderData.note || ''
                }]);
                setNewReminderData({ date: format(today, 'yyyy-MM-dd'), unitId: '', note: '', type: 'checkin' });
              }} className="mt-4 w-full bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600 transition-colors">
                Add Reminder
              </button>
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-gray-700">All Reminders</h3>
              {reminders.length > 0 ? (
                reminders
                  .sort((a, b) => a.date - b.date)
                  .map((r, index) => (
                    <div key={index} className={`flex justify-between items-center p-3 rounded-md border text-sm ${
                      r.type === 'checkin' ? 'bg-blue-100 border-blue-500' : 
                      r.type === 'checkout' ? 'bg-red-100 border-red-500' : 
                      r.type === 'rent' ? 'bg-green-100 border-green-500' : 
                      r.type === 'vacant' ? 'bg-yellow-100 border-yellow-500' : 
                      'bg-gray-100 border-gray-500'
                    }`}>
                      <div>
                        <p className="font-bold">{format(r.date, 'MMM d, yyyy')}</p>
                        <p>{r.text}</p>
                      </div>
                      <button onClick={() => {
                        setReminders(prev => prev.filter((_, i) => i !== index));
                      }} className="text-red-500 hover:text-red-700 transition-colors text-sm">
                        ×
                      </button>
                    </div>
                  ))
              ) : (
                <p className="text-gray-500 italic text-center">No upcoming reminders.</p>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Confirmation Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white p-6 rounded-xl shadow-2xl max-w-sm w-full relative">
            <h3 className="text-lg font-bold mb-3">Confirm Deletion</h3>
            <p className="mb-4 text-sm">{confirmMessage}</p>
            <div className="flex justify-end gap-2">
              <button
                className="bg-gray-300 text-gray-800 px-3 py-1.5 text-sm rounded-full hover:bg-gray-400"
                onClick={() => setIsConfirmModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="bg-red-500 text-white px-3 py-1.5 text-sm rounded-full hover:bg-red-600"
                onClick={() => confirmAction()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Booking Modal */}
      {isModalOpen && modalData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-1 z-50">
          <div className="bg-white p-3 md:p-4 rounded-lg shadow-2xl max-w-4xl w-full max-h-[98vh] overflow-y-auto relative text-sm">
            <button
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={handleCloseModal}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-lg md:text-xl font-bold text-gray-800">Booking Details - {units.find(u => u.id === modalData.unitId)?.name}</h2>
            
            {/* Unit Selection for Moving Bookings */}
            <div className="mt-2 p-2 bg-gray-50 rounded">
              <label className="text-xs font-medium">Unit:</label>
              <select
                className="input-field text-xs mt-1 h-8"
                value={modalData.unitId}
                onChange={(e) => setModalData(prev => ({ ...prev, unitId: e.target.value }))}
              >
                {units.map(unit => {
                  const property = properties.find(p => p.id === unit.propertyId);
                  return (
                    <option key={unit.id} value={unit.id}>
                      {property?.name} - {unit.name}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {/* Guest & Contact Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">First Name:</label>
                  <input type="text" className="input-field w-20ch" name="firstName" value={modalData.firstName ?? ''} onChange={(e) => {
                    const { name, value } = e.target;
                    setModalData(prev => {
                      const updatedData = { ...prev, [name]: value };
                      if (name === 'checkIn' || name === 'checkout' || name === 'dailyRate' || name === 'weeklyRate' || name === 'monthlyRate') {
                        const newCheckIn = updatedData.checkIn;
                        const newCheckout = updatedData.checkout;
                        if (newCheckIn && newCheckout) {
                          updatedData.lineItems = calculateLineItems(newCheckIn, newCheckout, updatedData.dailyRate, updatedData.weeklyRate, updatedData.monthlyRate);
                        }
                      }
                      return updatedData;
                    });
                  }} />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Last Name:</label>
                  <input type="text" className="input-field w-20ch" name="lastName" value={modalData.lastName ?? ''} onChange={(e) => {
                    const { name, value } = e.target;
                    setModalData(prev => ({ ...prev, [name]: value }));
                  }} />
                </div>
                <div className="flex items-center gap-1 text-xs pt-2">
                    <label className="flex items-center gap-1">
                      <input type="radio" name="status" value="checkedIn" checked={modalData.status === "checkedIn"} onChange={(e) => {
                        setModalData(prev => ({ ...prev, status: e.target.value }));
                      }} />
                      <span style={{fontSize: '0.65rem'}}>Checked In</span>
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="status" value="checkedOut" checked={modalData.status === "checkedOut"} onChange={(e) => {
                        setModalData(prev => ({ ...prev, status: e.target.value }));
                      }} />
                      <span style={{fontSize: '0.65rem'}}>Checkout</span>
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="status" value="future" checked={modalData.status === "future"} onChange={(e) => {
                        setModalData(prev => ({ ...prev, status: e.target.value }));
                      }} />
                      <span style={{fontSize: '0.65rem'}}>None</span>
                    </label>
                </div>
              </div>
              
              {/* Contact Information */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center gap-2">
                  <input type="radio" name="preferredContact" value="Phone" checked={modalData.preferredContact === "Phone"} onChange={(e) => setModalData(prev => ({ ...prev, preferredContact: e.target.value }))} />
                  <span className="text-xs font-medium">Phone:</span>
                  <input type="text" className="input-field w-20ch" name="phone" value={modalData.phone ?? ''} onChange={(e) => setModalData(prev => ({ ...prev, phone: e.target.value }))} />
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="preferredContact" value="Email" checked={modalData.preferredContact === "Email"} onChange={(e) => setModalData(prev => ({ ...prev, preferredContact: e.target.value }))} />
                  <span className="text-xs font-medium">Email:</span>
                  <input type="text" className="input-field w-20ch" name="email" value={modalData.email ?? ''} onChange={(e) => setModalData(prev => ({ ...prev, email: e.target.value }))} />
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="preferredContact" value="Whatsapp" checked={modalData.preferredContact === "Whatsapp"} onChange={(e) => setModalData(prev => ({ ...prev, preferredContact: e.target.value }))} />
                  <span className="text-xs font-medium">WhatsApp:</span>
                  <input type="text" className="input-field w-20ch" name="whatsapp" value={modalData.whatsapp ?? ''} onChange={(e) => setModalData(prev => ({ ...prev, whatsapp: e.target.value }))} />
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="preferredContact" value="Line" checked={modalData.preferredContact === "Line"} onChange={(e) => setModalData(prev => ({ ...prev, preferredContact: e.target.value }))} />
                  <span className="text-xs font-medium">LINE:</span>
                  <input type="text" className="input-field w-20ch" name="line" value={modalData.line ?? ''} onChange={(e) => setModalData(prev => ({ ...prev, line: e.target.value }))} />
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="preferredContact" value="Instagram" checked={modalData.preferredContact === "Instagram"} onChange={(e) => setModalData(prev => ({ ...prev, preferredContact: e.target.value }))} />
                  <span className="text-xs font-medium">Instagram:</span>
                  <input type="text" className="input-field w-20ch" name="instagram" value={modalData.instagram ?? ''} onChange={(e) => setModalData(prev => ({ ...prev, instagram: e.target.value }))} />
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="preferredContact" value="Facebook" checked={modalData.preferredContact === "Facebook"} onChange={(e) => setModalData(prev => ({ ...prev, preferredContact: e.target.value }))} />
                  <span className="text-xs font-medium">Facebook:</span>
                  <input type="text" className="input-field w-20ch" name="facebook" value={modalData.facebook ?? ''} onChange={(e) => setModalData(prev => ({ ...prev, facebook: e.target.value }))} />
                </label>
              </div>
              
              {/* Booking Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Check-in:</label>
                  <input type="date" className="input-field w-20ch" name="checkIn" value={modalData.checkIn ?? ''} onChange={(e) => {
                    const { name, value } = e.target;
                    setModalData(prev => {
                      const updatedData = { ...prev, [name]: value };
                      if (name === 'checkIn' || name === 'checkout') {
                        const newCheckIn = updatedData.checkIn;
                        const newCheckout = updatedData.checkout;
                        if (newCheckIn && newCheckout) {
                          updatedData.lineItems = calculateLineItems(newCheckIn, newCheckout, updatedData.dailyRate, updatedData.weeklyRate, updatedData.monthlyRate);
                        }
                      }
                      return updatedData;
                    });
                  }} />
                  <span className="text-xs text-gray-500">{getDaysDuration(modalData.checkIn, modalData.checkout)}</span>
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Checkout:</label>
                  <input type="date" className="input-field w-20ch" name="checkout" value={modalData.checkout ?? ''} onChange={(e) => {
                    const { name, value } = e.target;
                    setModalData(prev => {
                      const updatedData = { ...prev, [name]: value };
                      if (name === 'checkIn' || name === 'checkout') {
                        const newCheckIn = updatedData.checkIn;
                        const newCheckout = updatedData.checkout;
                        if (newCheckIn && newCheckout) {
                          updatedData.lineItems = calculateLineItems(newCheckIn, newCheckout, updatedData.dailyRate, updatedData.weeklyRate, updatedData.monthlyRate);
                        }
                      }
                      return updatedData;
                    });
                  }} />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Deposit (฿):</label>
                  <div className="flex flex-col gap-2">
                    <input type="number" className="input-field w-20ch" name="deposit" value={modalData.deposit ?? 0} onChange={(e) => setModalData(prev => ({ ...prev, deposit: Number(e.target.value) }))} />
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-1 text-xs">
                        <input 
                          type="checkbox" 
                          checked={modalData.depositCollected || false}
                          onChange={(e) => setModalData(prev => ({ ...prev, depositCollected: e.target.checked }))}
                        />
                        Collected
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <input 
                          type="checkbox" 
                          checked={modalData.depositRefunded || false}
                          onChange={(e) => setModalData(prev => ({ ...prev, depositRefunded: e.target.checked }))}
                        />
                        Refunded
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Rates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Monthly Rate (฿):</label>
                  <input type="number" className="input-field w-20ch" name="monthlyRate" value={modalData.monthlyRate ?? 0} onChange={(e) => {
                    const value = Number(e.target.value);
                    setModalData(prev => {
                      const updatedData = { ...prev, monthlyRate: value };
                      if (updatedData.checkIn && updatedData.checkout) {
                        updatedData.lineItems = calculateLineItems(updatedData.checkIn, updatedData.checkout, updatedData.dailyRate, updatedData.weeklyRate, value);
                      }
                      return updatedData;
                    });
                  }} />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Weekly Rate:</label>
                  <input type="number" className="input-field w-20ch" name="weeklyRate" value={modalData.weeklyRate ?? 0} onChange={(e) => {
                    const value = Number(e.target.value);
                    setModalData(prev => {
                      const updatedData = { ...prev, weeklyRate: value };
                      if (updatedData.checkIn && updatedData.checkout) {
                        updatedData.lineItems = calculateLineItems(updatedData.checkIn, updatedData.checkout, updatedData.dailyRate, value, updatedData.monthlyRate);
                      }
                      return updatedData;
                    });
                  }} />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Daily Rate:</label>
                  <input type="number" className="input-field w-20ch" name="dailyRate" value={modalData.dailyRate ?? 0} onChange={(e) => {
                    const value = Number(e.target.value);
                    setModalData(prev => {
                      const updatedData = { ...prev, dailyRate: value };
                      if (updatedData.checkIn && updatedData.checkout) {
                        updatedData.lineItems = calculateLineItems(updatedData.checkIn, updatedData.checkout, value, updatedData.weeklyRate, updatedData.monthlyRate);
                      }
                      return updatedData;
                    });
                  }} />
                </div>
              </div>
              
              {/* Source and Pricing Info */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Source:</label>
                  <select
                    className="input-field"
                    name="source"
                    value={modalData.source}
                    onChange={(e) => setModalData(prev => ({ ...prev, source: e.target.value }))}
                  >
                    <option value="direct">Direct</option>
                    <option value="facebook">Facebook</option>
                    <option value="airbnb">AirBnB</option>
                    <option value="agent">Agent</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Total Price:</label>
                  <input type="number" className="input-field" name="totalPrice" value={modalData.totalPrice ?? 0} onChange={(e) => setModalData(prev => ({ ...prev, totalPrice: Number(e.target.value) }))} />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Commission:</label>
                  <input type="number" className="input-field" name="commission" value={modalData.commission ?? 0} onChange={(e) => setModalData(prev => ({ ...prev, commission: Number(e.target.value) }))} />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Net Price:</label>
                  <div className="input-field bg-gray-200 cursor-not-allowed">
                    {((modalData.totalPrice || 0) - (modalData.commission || 0)).toFixed(2)}฿
                  </div>
                </div>
              </div>
              
              {/* Payments and Meter Readings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
                {/* Payments */}
                <div className="bg-white p-4 rounded-lg shadow-inner">
                  <h3 className="font-bold mb-2">Payments</h3>
                  <ul className="text-sm space-y-2 mb-2 max-h-40 overflow-y-auto">
                    {modalData.payments?.sort((a, b) => new Date(a.date) - new Date(b.date)).map((p, idx) => (
                      <li key={idx} className="flex justify-between items-center bg-gray-100 p-2 rounded-md">
                        <input
                          type="date"
                          value={p.date ?? ''}
                          onChange={(e) => {
                            const newPayments = [...modalData.payments];
                            newPayments[idx] = { ...newPayments[idx], date: e.target.value };
                            setModalData(prev => ({ ...prev, payments: newPayments }));
                          }}
                          className="w-24 text-xs border rounded-md"
                        />
                        <select
                          className="w-20 text-xs border rounded-md"
                          value={p.category ?? 'Rent'}
                          onChange={(e) => {
                            const newPayments = [...modalData.payments];
                            newPayments[idx] = { ...newPayments[idx], category: e.target.value };
                            setModalData(prev => ({ ...prev, payments: newPayments }));
                          }}
                        >
                          <option value="Rent">Rent</option>
                          <option value="Utility">Utility</option>
                          <option value="Deposit">Deposit</option>
                          <option value="Other">Other</option>
                        </select>
                        <input
                          type="number"
                          value={p.amount ?? 0}
                          onChange={(e) => {
                            const newPayments = [...modalData.payments];
                            newPayments[idx] = { ...newPayments[idx], amount: Number(e.target.value) };
                            setModalData(prev => ({ ...prev, payments: newPayments }));
                          }}
                          className="w-16 text-xs text-right border rounded-md"
                        />฿
                        <button
                          onClick={() => {
                            const newPayments = modalData.payments.filter((_, i) => i !== idx);
                            setModalData(prev => ({ ...prev, payments: newPayments }));
                          }}
                          className="text-red-500 hover:text-red-700 ml-1 text-xs"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center">
                    <input
                      type="number"
                      id="newPaymentAmount"
                      placeholder="Amount"
                      className="input-field mr-2 w-24"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const amount = Number(e.target.value);
                          const category = document.getElementById("newPaymentCategory").value;
                          if (amount > 0) {
                            setModalData(prev => ({
                              ...prev,
                              payments: [...prev.payments, { date: format(new Date(), 'yyyy-MM-dd'), amount, category }]
                            }));
                            e.target.value = "";
                          }
                        }
                      }}
                    />
                    <select id="newPaymentCategory" className="input-field mr-2 w-24">
                          <option value="Rent">Rent</option>
                          <option value="Utility">Utility</option>
                          <option value="Deposit">Deposit</option>
                          <option value="Other">Other</option>
                    </select>
                    <button
                      className="bg-blue-500 text-white px-3 py-1 rounded-full hover:bg-blue-600"
                      onClick={() => {
                        const input = document.getElementById("newPaymentAmount");
                        const category = document.getElementById("newPaymentCategory");
                        const amount = Number(input.value);
                        if (amount > 0) {
                          setModalData(prev => ({
                            ...prev,
                            payments: [...prev.payments, { date: format(new Date(), 'yyyy-MM-dd'), amount, category: category.value }]
                          }));
                          input.value = "";
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
                
                {/* Meter Readings */}
                <div className="bg-white p-4 rounded-lg shadow-inner">
                  <h3 className="font-bold mb-2">Meter Readings</h3>
                  <ul className="text-sm space-y-2 mb-2 max-h-40 overflow-y-auto">
                    {modalData.meterReadings?.sort((a, b) => new Date(a.date) - new Date(b.date)).map((m, idx) => (
                      <li key={idx} className="flex justify-between items-center bg-gray-100 p-2 rounded-md">
                        <input
                          type="date"
                          value={m.date ?? ''}
                          onChange={(e) => {
                            const newReadings = [...modalData.meterReadings];
                            newReadings[idx].date = e.target.value;
                            setModalData(prev => ({ ...prev, meterReadings: newReadings }));
                          }}
                          className="w-24 text-xs border rounded-md"
                        />
                        <input
                          type="number"
                          value={m.reading ?? 0}
                          onChange={(e) => {
                            const newReadings = [...modalData.meterReadings];
                            newReadings[idx].reading = Number(e.target.value);
                            setModalData(prev => ({ ...prev, meterReadings: newReadings }));
                          }}
                          className="w-16 text-xs text-right border rounded-md"
                        />
                        <span className="text-xs font-semibold">
                          {idx > 0 ? ((m.reading - modalData.meterReadings.sort((a, b) => new Date(a.date) - new Date(b.date))[idx-1].reading) * (modalData.electricRate ?? meterRate)).toFixed(0) : 0}฿
                        </span>
                        <button
                          onClick={() => {
                            const newReadings = modalData.meterReadings.filter((_, i) => i !== idx);
                            setModalData(prev => ({ ...prev, meterReadings: newReadings }));
                          }}
                          className="text-red-500 hover:text-red-700 ml-1 text-xs"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center">
                    <input
                      type="number"
                      id="newMeterReading"
                      placeholder="Reading"
                      className="input-field mr-2 w-24"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const reading = Number(e.target.value);
                          if (reading > 0) {
                            setModalData(prev => ({
                              ...prev,
                              meterReadings: [...prev.meterReadings, { date: format(new Date(), 'yyyy-MM-dd'), reading }]
                            }));
                            e.target.value = "";
                          }
                        }
                      }}
                    />
                    <button
                      className="bg-blue-500 text-white px-3 py-1 rounded-full hover:bg-blue-600"
                      onClick={() => {
                        const input = document.getElementById("newMeterReading");
                        const reading = Number(input.value);
                        if (reading > 0) {
                          setModalData(prev => ({
                            ...prev,
                            meterReadings: [...prev.meterReadings, { date: format(new Date(), 'yyyy-MM-dd'), reading }]
                          }));
                          input.value = "";
                        }
                      }}
                    >
                      Add
                    </button>
                    <button
                      className="bg-green-500 text-white px-2 py-1 text-xs rounded-full hover:bg-green-600 ml-2"
                      onClick={handleAutoFillMeterReading}
                    >
                      Auto Fill
                    </button>
                  </div>
                  <div className="flex flex-col mt-4">
                      <label className="flex items-center gap-2">
                        <span className="text-xs font-medium">Electric (฿/kWh):</span>
                        <input type="number" className="input-field w-15ch" name="electricRate" value={modalData.electricRate ?? meterRate} onChange={(e) => setModalData(prev => ({ ...prev, electricRate: Number(e.target.value) }))} />
                      </label>
                  </div>
                  <div className="flex flex-col mt-4">
                      <label className="flex items-center gap-2">
                            <span className="text-xs font-medium">Water (฿/Mo):</span>
                            <input type="number" className="input-field w-20ch" name="monthlyWaterCharge" value={modalData.monthlyWaterCharge ?? 0} onChange={(e) => setModalData(prev => ({ ...prev, monthlyWaterCharge: Number(e.target.value) }))} />
                      </label>
                  </div>
                </div>
              </div>
              
              {/* Financial Summary */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-8 p-4 border rounded-lg bg-gray-50">
                <div>
                  <h4 className="font-bold mb-2">Total Costs</h4>
                  <ul className="text-sm space-y-1">
                    <li className="flex justify-between cursor-pointer" onClick={() => setIsRentBreakdownExpanded(!isRentBreakdownExpanded)}>
                      <span className="text-gray-600">Total Rent:</span>
                      <span className="font-semibold">{getRentCost(modalData).toFixed(0)}฿</span>
                    </li>
                    {isRentBreakdownExpanded && (
                      <div className="mt-2 text-sm bg-gray-100 p-2 rounded">
                        <h5 className="font-semibold mb-1">Rental Breakdown:</h5>
                        <ul className="space-y-1">
                          {modalData.totalPrice && modalData.totalPrice > 0 ? (
                            <li className="flex justify-between">
                               <span>Net Price:</span>
                               <span>{(modalData.totalPrice - modalData.commission).toFixed(0)}฿</span>
                            </li>
                           ) : (
                               modalData.lineItems.map((item, index) => (
                               <li key={index} className="flex justify-between">
                                   <span>{format(typeof item.startDate === 'string' ? parseISO(item.startDate) : new Date(item.startDate), 'dMMM').toUpperCase()} - {format(typeof item.endDate === 'string' ? parseISO(item.endDate) : new Date(item.endDate), 'dMMM').toUpperCase()}:</span>
                                   <span>{item.cost.toFixed(0)}฿ ({item.type.charAt(0).toUpperCase()})</span>
                               </li>
                               ))
                           )}
                        </ul>
                      </div>
                    )}
                    <li className="flex justify-between cursor-pointer" onClick={() => setIsElectricBreakdownExpanded(!isElectricBreakdownExpanded)}>
                      <span className="text-gray-600">Total Electric:</span>
                      <span className="font-semibold">{getMeterCost(modalData.meterReadings, modalData.electricRate || meterRate).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between cursor-pointer" onClick={() => setIsWaterBreakdownExpanded(!isWaterBreakdownExpanded)}>
                      <span className="text-gray-600">Total Water:</span>
                      <span className="font-semibold">{getWaterCost(modalData).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-gray-600">Deposit Status:</span>
                      <span className="font-semibold">
                        {modalData.depositCollected ? 
                          (modalData.depositRefunded ? '✅ Refunded' : '✅ Collected') : 
                          '❌ Not Collected'
                        } ({modalData.deposit.toFixed(0)}฿)
                      </span>
                    </li>
                    <li className="flex justify-between font-bold pt-2 mt-2 border-t">
                      <span>Total Cost:</span>
                      <span>{getTotalCost(modalData).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-gray-600">Rent Paid:</span>
                      <span className="font-semibold">{getRentPaid(modalData.payments).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-gray-600">Total Payments:</span>
                      <span className="font-semibold">{getAmountPaid(modalData.payments).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between font-bold">
                      <span>Balance Due:</span>
                      <span className={getAmountDue(modalData) > 2 ? 'text-red-700' : 'text-green-700'}>{getAmountDue(modalData).toFixed(0)}฿</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-bold mb-2">Current Costs</h4>
                  <ul className="text-sm space-y-1">
                    <li className="flex justify-between">
                      <span className="text-gray-600">Rent:</span>
                      <span className="font-semibold">{getDueNowRent(modalData).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-gray-600">Electric:</span>
                      <span className="font-semibold">{getMeterCost(modalData.meterReadings, modalData.electricRate || meterRate).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-gray-600">Water:</span>
                      <span className="font-semibold">{(differenceInMonths(today, parseISO(modalData.checkIn)) * (modalData.monthlyWaterCharge || 0)).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-gray-600">Deposit:</span>
                      <span className="font-semibold">{modalData.deposit.toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between font-bold pt-2 mt-2 border-t">
                      <span>Total Due Now:</span>
                      <span>{getDueNow(modalData).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-gray-600">Amount Paid:</span>
                      <span className="font-semibold">{getAmountPaid(modalData.payments).toFixed(0)}฿</span>
                    </li>
                    <li className="flex justify-between font-bold">
                      <span>Remaining Balance:</span>
                      <span>{(getDueNow(modalData) - getAmountPaid(modalData.payments)).toFixed(0)}฿</span>
                    </li>
                  </ul>
                </div>
              </div>
              
              {/* Notes Field */}
              <div className="flex flex-col mt-4">
                <label className="text-xs font-medium">Notes:</label>
                <textarea className="input-field h-24" name="notes" value={modalData.notes ?? ''} onChange={(e) => setModalData(prev => ({ ...prev, notes: e.target.value }))}></textarea>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 mt-3">
              <button 
                className="bg-red-500 text-white px-3 py-1.5 text-xs rounded-full hover:bg-red-600" 
                onClick={() => {
                  setConfirmMessage('Are you sure you want to delete this booking? This cannot be undone.');
                  setConfirmAction(() => async () => {
                    try {
                      await axios.delete(`${API}/bookings/${modalData.id}`);
                      await fetchData();
                      handleShowAlert('Booking deleted successfully!');
                      setIsConfirmModalOpen(false);
                      handleCloseModal();
                    } catch (e) {
                      console.error("Error deleting booking:", e);
                      handleShowAlert("Failed to delete booking. Please try again.");
                      setIsConfirmModalOpen(false);
                    }
                  });
                  setIsConfirmModalOpen(true);
                }}
              >
                Delete Booking
              </button>
              <button className="bg-gray-300 text-gray-800 px-3 py-1.5 text-xs rounded-full hover:bg-gray-400" onClick={handleCloseModal}>Close</button>
              <button className="bg-blue-500 text-white px-3 py-1.5 text-xs rounded-full hover:bg-blue-600" onClick={handleSaveModal}>Save Booking</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Unit Edit Modal */}
      {isUnitModalOpen && editingUnit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-8 rounded-xl shadow-2xl max-w-lg w-full relative">
            <button
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => setIsUnitModalOpen(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-2xl font-bold text-gray-800">Edit Unit: {editingUnit.name ?? ''}</h2>
            <div className="mt-6 space-y-4">
              <div className="flex flex-col">
                <label className="text-xs font-medium">Unit Name:</label>
                <input
                  type="text"
                  className="input-field"
                  value={editingUnit.name ?? ''}
                  onChange={e => setEditingUnit(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium">Property:</label>
                <select
                  className="input-field"
                  value={editingUnit.propertyId}
                  onChange={e => setEditingUnit(prev => ({ ...prev, propertyId: e.target.value }))}
                >
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium">Description:</label>
                <textarea
                  className="input-field h-24"
                  value={editingUnit.description ?? ''}
                  onChange={e => setEditingUnit(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Daily Rate:</label>
                  <input
                    type="number"
                    className="input-field"
                    value={editingUnit.dailyRate ?? 0}
                    onChange={e => setEditingUnit(prev => ({ ...prev, dailyRate: Number(e.target.value) }))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Weekly Rate:</label>
                  <input
                    type="number"
                    className="input-field"
                    value={editingUnit.weeklyRate ?? 0}
                    onChange={e => setEditingUnit(prev => ({ ...prev, weeklyRate: Number(e.target.value) }))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Monthly Rate:</label>
                  <input
                    type="number"
                    className="input-field"
                    value={editingUnit.monthlyRate ?? 0}
                    onChange={e => setEditingUnit(prev => ({ ...prev, monthlyRate: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="bg-gray-300 text-gray-800 px-6 py-2 rounded-full hover:bg-gray-400" onClick={() => setIsUnitModalOpen(false)}>Cancel</button>
              <button className="bg-blue-500 text-white px-6 py-2 rounded-full hover:bg-blue-600" onClick={handleSaveUnit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Property Edit Modal */}
      {isPropertyEditModalOpen && editingProperty && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative">
            <button
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => setIsPropertyEditModalOpen(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-gray-800 mb-4">Edit Property: {editingProperty.name ?? ''}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Property Name:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editingProperty.name ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Address:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editingProperty.address ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, address: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">WiFi Password:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editingProperty.wifiPassword ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, wifiPassword: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Electric Account #:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editingProperty.electricAccount ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, electricAccount: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Water Account #:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editingProperty.waterAccount ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, waterAccount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Internet Account #:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editingProperty.internetAccount ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, internetAccount: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Rent Amount:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editingProperty.rentAmount ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, rentAmount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium">Rent Payment Details:</label>
                <textarea
                  className="input-field h-16 resize-none"
                  value={editingProperty.rentPaymentDetails ?? ''}
                  onChange={e => setEditingProperty(prev => ({ ...prev, rentPaymentDetails: e.target.value }))}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium">Contact Information:</label>
                <textarea
                  className="input-field h-16 resize-none"
                  value={editingProperty.contactInfo ?? ''}
                  onChange={e => setEditingProperty(prev => ({ ...prev, contactInfo: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Number of Units:</label>
                  <input
                    type="number"
                    className="input-field"
                    value={editingProperty.unitsCount ?? 0}
                    onChange={e => setEditingProperty(prev => ({ ...prev, unitsCount: Number(e.target.value) }))}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium">Description:</label>
                  <textarea
                    className="input-field h-16 resize-none"
                    value={editingProperty.description ?? ''}
                    onChange={e => setEditingProperty(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="bg-gray-300 text-gray-800 px-4 py-1.5 text-sm rounded-full hover:bg-gray-400" onClick={() => setIsPropertyEditModalOpen(false)}>Cancel</button>
              <button className="bg-blue-500 text-white px-4 py-1.5 text-sm rounded-full hover:bg-blue-600" onClick={handleSaveProperty}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;