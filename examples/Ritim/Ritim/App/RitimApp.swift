import SwiftData
import SwiftUI

@main
struct RitimApp: App {
    private let container: ModelContainer
    @State private var router: AppRouter
    @State private var store = PlusStore()

    init() {
        if VitrinDemo.isActive {
            container = VitrinDemo.makeContainer()
        } else {
            do {
                container = try ModelContainer(for: Habit.self, HabitLog.self)
            } catch {
                fatalError("Could not open the Ritim store: \(error)")
            }
        }
        _router = State(initialValue: AppRouter(initialScreen: VitrinDemo.requestedScreen))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(router)
                .environment(store)
                .task { await store.load() }
        }
        .modelContainer(container)
    }
}

struct RootView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            Tab("Today", systemImage: "checkmark.circle.fill", value: AppTab.today) {
                HomeView()
            }
            Tab("Statistics", systemImage: "chart.bar.fill", value: AppTab.stats) {
                StatsView()
            }
            Tab("Reminders", systemImage: "bell.fill", value: AppTab.reminders) {
                RemindersView()
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .sheet(isPresented: $router.isAddingHabit) {
            AddHabitView()
        }
        .fullScreenCover(isPresented: $router.isShowingPaywall) {
            PaywallView()
        }
    }
}
