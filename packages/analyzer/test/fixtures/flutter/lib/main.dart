import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fl_chart/fl_chart.dart';

const _vitrin = MethodChannel('vitrin');

Future<Map<String, dynamic>> vitrinDemoArgs() async =>
    Map<String, dynamic>.from(await _vitrin.invokeMethod('launchArgs') ?? {});

void main() => runApp(const MaterialApp(home: Placeholder()));
