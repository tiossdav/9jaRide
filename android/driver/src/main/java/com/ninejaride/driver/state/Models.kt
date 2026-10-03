package com.ninejaride.driver.state

import com.ninejaride.core.format.Kobo

data class Vehicle(val make: String, val model: String, val year: Int, val plate: String, val colour: String)

data class BankAccount(val bank: String, val number: String, val holder: String)

data class DriverProfile(
    val name: String,
    val phone: String,
    val email: String,
    val emailVerified: Boolean,
    val gender: String,
    val nin: String?,
    val rating: Int,
    val active: Boolean,
    val vehicle: Vehicle?,
    val bank: BankAccount?,
)

data class Rider(val name: String, val rating: Int)

data class RideOffer(
    val code: String,
    val category: String,
    val payment: String,
    val pickupKm: Double,
    val pickupMin: Int,
    val fare: Kobo,
    val pickup: String,
    val dropoff: String,
    val rider: Rider,
)

/** The receipt lines as the server prices them. The fare is the sum of the lines; rounding is its own line. */
data class FareLine(val label: String, val amount: Kobo, val signed: Boolean = false)

data class FareReceipt(val lines: List<FareLine>, val total: Kobo, val serviceCharge: Kobo, val earn: Kobo, val serviceRatePercent: Int = 12)

data class TripRecord(
    val code: String,
    val whenText: String,
    val receipt: FareReceipt,
    val pickup: String,
    val dropoff: String,
    val distanceKm: Double,
    val durationSeconds: Int,
    val payment: String,
    val rider: Rider,
)

enum class TxDirection { In, Out }

data class WalletTx(val title: String, val whenText: String, val amount: Kobo, val direction: TxDirection)

data class PayoutRecord(val whenText: String, val amount: Kobo, val status: String)

/** One row of "Before you go online". */
data class Check(val ok: Boolean, val title: String, val detail: String, val action: String? = null)

val DEMO_PROFILE = DriverProfile(
    name = "Victor Taiwo",
    phone = "0803 000 0010",
    email = "victortaiwo57@gmail.com",
    emailVerified = false,
    gender = "Male",
    nin = null,
    rating = 5,
    active = true,
    vehicle = Vehicle("Toyota", "Camry", 2013, "FKJ-222AB", "Blue"),
    bank = null,
)

val DEMO_OFFER = RideOffer(
    code = "7K3M-92QD",
    category = "Regular",
    payment = "Cash",
    pickupKm = 1.2,
    pickupMin = 4,
    fare = 226_000,
    pickup = "CXX4+65G, Akobo, Ibadan, Oyo",
    dropoff = "Iwo Road, Ibadan, Nigeria",
    rider = Rider("Olaoluwa", 5),
)

/** The trip in the design: 0.65 km, 9m 15s, cash. Service charge is 12% of the fare. */
val DEMO_RECEIPT = FareReceipt(
    lines = listOf(
        FareLine("Service charge", 100_000),
        FareLine("Distance fee · 0.65 km", 11_700),
        FareLine("Time fee · 9m 15s", 110_976),
        FareLine("Waiting fee · 1m 20s", 0),
        FareLine("Tax", 3_000),
        FareLine("Rounding to nearest ₦10", 324, signed = true),
    ),
    total = 226_000,
    serviceCharge = 27_120,
    earn = 198_880,
)
