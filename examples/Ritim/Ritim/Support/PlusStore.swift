import Observation
import StoreKit

/// Minimal StoreKit 2 wrapper for the "Ritim Plus" monthly subscription.
/// Products come from `Ritim.storekit` when running from Xcode.
@MainActor
@Observable
final class PlusStore {
    static let monthlyProductID = "com.jastech.ritim.plus.monthly"

    private(set) var product: Product?
    private(set) var isSubscribed = false
    private(set) var isPurchasing = false

    func load() async {
        // Demo mode never talks to StoreKit so screenshots stay deterministic.
        guard !VitrinDemo.isActive else { return }
        product = try? await Product.products(for: [Self.monthlyProductID]).first
        await refreshEntitlements()
    }

    func refreshEntitlements() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == Self.monthlyProductID,
               transaction.revocationDate == nil {
                active = true
            }
        }
        isSubscribed = active
    }

    func purchase() async {
        guard let product, !isPurchasing else { return }
        isPurchasing = true
        defer { isPurchasing = false }
        guard let result = try? await product.purchase() else { return }
        if case .success(let verification) = result, case .verified(let transaction) = verification {
            await transaction.finish()
            isSubscribed = true
        }
    }

    func restore() async {
        guard !VitrinDemo.isActive else { return }
        try? await AppStore.sync()
        await refreshEntitlements()
    }
}
