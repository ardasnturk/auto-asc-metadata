package com.example.notes

class MainActivity : ComponentActivity() {
    private val vitrinDemo get() = intent.getBooleanExtra("vitrinDemo", false)
    private val vitrinScreen get() = intent.getStringExtra("vitrinScreen")
}
